import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";

import * as fs from "fs";
import * as path from "path";

export class InfrastructureStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //
        // VPC
        //
        // Public subnets only.
        // Instances need internet access for installing packages,
        // downloading models and pulling container images.
        //
        const vpc = new ec2.Vpc(this, "AiVpc", {
            maxAzs: 2,
            natGateways: 0,

            subnetConfiguration: [
                {
                    name: "public",
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24
                }
            ]
        });

        //
        // Public ALB Security Group
        //
        const publicAlbSecurityGroup = new ec2.SecurityGroup(
            this,
            "PublicAlbSecurityGroup",
            {
                vpc,
                allowAllOutbound: true
            }
        );

        publicAlbSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(80),
            "Public HTTP access"
        );

        //
        // API Security Group
        //
        // API instances are reachable only from the public ALB.
        //
        const apiSecurityGroup = new ec2.SecurityGroup(
            this,
            "ApiSecurityGroup",
            {
                vpc,
                allowAllOutbound: true
            }
        );

        apiSecurityGroup.addIngressRule(
            publicAlbSecurityGroup,
            ec2.Port.tcp(8000),
            "Public ALB to API instances"
        );

        //
        // Internal GPU ALB Security Group
        //
        // Only API instances can reach the internal ALB.
        //
        const internalAlbSecurityGroup = new ec2.SecurityGroup(
            this,
            "InternalAlbSecurityGroup",
            {
                vpc,
                allowAllOutbound: true
            }
        );

        internalAlbSecurityGroup.addIngressRule(
            apiSecurityGroup,
            ec2.Port.tcp(8000),
            "API instances to internal GPU ALB"
        );

        //
        // GPU Security Group
        //
        // GPU instances are reachable only from the internal ALB.
        //
        const gpuSecurityGroup = new ec2.SecurityGroup(
            this,
            "GpuSecurityGroup",
            {
                vpc,
                allowAllOutbound: true
            }
        );

        gpuSecurityGroup.addIngressRule(
            internalAlbSecurityGroup,
            ec2.Port.tcp(8000),
            "Internal ALB to vLLM instances"
        );

        //
        // API EC2 Role
        //
        const apiRole = new iam.Role(this, "ApiRole", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com")
        });

        apiRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "AmazonSSMManagedInstanceCore"
            )
        );

        //
        // GPU EC2 Role
        //
        const gpuRole = new iam.Role(this, "GpuRole", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com")
        });

        gpuRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "AmazonSSMManagedInstanceCore"
            )
        );

        //
        // Upload API code
        //
        const apiAsset = new s3assets.Asset(
            this,
            "ApiAsset",
            {
                path: path.join(__dirname, "../../api")
            }
        );

        apiAsset.grantRead(apiRole);

        //
        // Read GPU User Data
        //
        const gpuUserDataScript = fs.readFileSync(
            path.join(
                __dirname,
                "../scripts/gpu-user-data.sh"
            ),
            "utf8"
        );

        //
        // GPU Launch Template
        //
        const gpuLaunchTemplate = new ec2.LaunchTemplate(
            this,
            "GpuLaunchTemplate",
            {
                role: gpuRole,

                securityGroup: gpuSecurityGroup,

                instanceType: new ec2.InstanceType(
                    "g5.xlarge"
                ),

                machineImage: ec2.MachineImage.lookup({
                    name:
                        "Deep Learning OSS Nvidia Driver AMI GPU PyTorch*(Amazon Linux 2023)*",

                    owners: ["amazon"]
                }),

                associatePublicIpAddress: true,

                userData: ec2.UserData.custom(
                    gpuUserDataScript
                ),

                blockDevices: [
                    {
                        deviceName: "/dev/xvda",

                        volume: ec2.BlockDeviceVolume.ebs(
                            100,
                            {
                                volumeType:
                                    ec2.EbsDeviceVolumeType.GP3,

                                deleteOnTermination: true
                            }
                        )
                    }
                ]
            }
        );

        //
        // GPU Auto Scaling Group
        //
        const gpuAutoScalingGroup =
            new autoscaling.AutoScalingGroup(
                this,
                "GpuAutoScalingGroup",
                {
                    vpc,

                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PUBLIC
                    },

                    launchTemplate: gpuLaunchTemplate,

                    minCapacity: 2,
                    desiredCapacity: 2,
                    maxCapacity: 4,

                    healthCheck:
                        autoscaling.HealthCheck.elb({
                            grace: cdk.Duration.minutes(30)
                        })
                }
            );

        //
        // Internal GPU Application Load Balancer
        //
        const internalGpuAlb =
            new elbv2.ApplicationLoadBalancer(
                this,
                "InternalGpuAlb",
                {
                    vpc,

                    internetFacing: false,

                    securityGroup:
                        internalAlbSecurityGroup,

                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PUBLIC
                    }
                }
            );

        const internalGpuListener =
            internalGpuAlb.addListener(
                "InternalGpuListener",
                {
                    port: 8000,
                    protocol:
                        elbv2.ApplicationProtocol.HTTP,
                    open: false
                }
            );

        internalGpuListener.addTargets(
            "GpuTargets",
            {
                port: 8000,

                protocol:
                    elbv2.ApplicationProtocol.HTTP,

                targets: [
                    gpuAutoScalingGroup
                ],

                healthCheck: {
                    enabled: true,
                    path: "/health",
                    port: "8000",
                    healthyHttpCodes: "200",
                    interval:
                        cdk.Duration.seconds(30),
                    timeout:
                        cdk.Duration.seconds(10),
                    healthyThresholdCount: 2,
                    unhealthyThresholdCount: 5
                },

                deregistrationDelay:
                    cdk.Duration.seconds(60)
            }
        );

        //
        // Read API User Data
        //
        let apiUserDataScript = fs.readFileSync(
            path.join(
                __dirname,
                "../scripts/api-user-data.sh"
            ),
            "utf8"
        );

        apiUserDataScript = apiUserDataScript
            .replace(
                "{{S3_BUCKET}}",
                apiAsset.s3BucketName
            )
            .replace(
                "{{S3_KEY}}",
                apiAsset.s3ObjectKey
            )
            .replace(
                "{{GPU_PRIVATE_DNS}}",
                internalGpuAlb.loadBalancerDnsName
            );

        //
        // API Launch Template
        //
        const apiLaunchTemplate =
            new ec2.LaunchTemplate(
                this,
                "ApiLaunchTemplate",
                {
                    role: apiRole,

                    securityGroup:
                        apiSecurityGroup,

                    instanceType:
                        new ec2.InstanceType(
                            "t3.small"
                        ),

                    machineImage:
                        ec2.MachineImage.latestAmazonLinux2023(),

                    associatePublicIpAddress: true,

                    userData:
                        ec2.UserData.custom(
                            apiUserDataScript
                        )
                }
            );

        //
        // API Auto Scaling Group
        //
        const apiAutoScalingGroup =
            new autoscaling.AutoScalingGroup(
                this,
                "ApiAutoScalingGroup",
                {
                    vpc,

                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PUBLIC
                    },

                    launchTemplate:
                        apiLaunchTemplate,

                    minCapacity: 2,
                    desiredCapacity: 2,
                    maxCapacity: 4,

                    healthCheck:
                        autoscaling.HealthCheck.elb({
                            grace: cdk.Duration.minutes(10)
                        })
                }
            );

        //
        // Public API Application Load Balancer
        //
        const publicApiAlb =
            new elbv2.ApplicationLoadBalancer(
                this,
                "PublicApiAlb",
                {
                    vpc,

                    internetFacing: true,

                    securityGroup:
                        publicAlbSecurityGroup,

                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PUBLIC
                    }
                }
            );

        const publicApiListener =
            publicApiAlb.addListener(
                "PublicApiListener",
                {
                    port: 80,

                    protocol:
                        elbv2.ApplicationProtocol.HTTP,

                    open: false
                }
            );

        publicApiListener.addTargets(
            "ApiTargets",
            {
                port: 8000,

                protocol:
                    elbv2.ApplicationProtocol.HTTP,

                targets: [
                    apiAutoScalingGroup
                ],

                healthCheck: {
                    enabled: true,

                    path: "/",

                    port: "8000",

                    // Allows 404 responses so the application
                    // does not require a separate health endpoint.
                    healthyHttpCodes: "200-499",

                    interval:
                        cdk.Duration.seconds(30),

                    timeout:
                        cdk.Duration.seconds(10),

                    healthyThresholdCount: 2,

                    unhealthyThresholdCount: 5
                },

                deregistrationDelay:
                    cdk.Duration.seconds(30)
            }
        );

        //
        // CPU-based API Auto Scaling
        //
        apiAutoScalingGroup.scaleOnCpuUtilization(
            "ApiCpuScaling",
            {
                targetUtilizationPercent: 60,

                cooldown:
                    cdk.Duration.minutes(5)
            }
        );

        //
        // CPU-based GPU Auto Scaling
        //
        // This can later be replaced with a custom GPU or
        // request-count CloudWatch metric.
        //
        gpuAutoScalingGroup.scaleOnCpuUtilization(
            "GpuCpuScaling",
            {
                targetUtilizationPercent: 70,

                cooldown:
                    cdk.Duration.minutes(10)
            }
        );

        //
        // Outputs
        //
        new cdk.CfnOutput(
            this,
            "ApiEndpoint",
            {
                value:
                    "http://" +
                    publicApiAlb.loadBalancerDnsName
            }
        );

        new cdk.CfnOutput(
            this,
            "PublicAlbDns",
            {
                value:
                    publicApiAlb.loadBalancerDnsName
            }
        );

        new cdk.CfnOutput(
            this,
            "InternalGpuAlbDns",
            {
                value:
                    internalGpuAlb.loadBalancerDnsName
            }
        );
    }
}