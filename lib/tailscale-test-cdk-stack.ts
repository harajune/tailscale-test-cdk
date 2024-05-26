import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import 'dotenv/config';
import { assertNull } from './utils';

assertNull(process.env.TAILSCALE_AUTHKEY, "TAILSCALE_AUTHKEY環境変数が未定義です");
assertNull(process.env.EIP_ALLOCATION_ID, "EIP_ALLOCATION_ID環境変数が未定義です");

const TAILSCALE_AUTHKEY = process.env.TAILSCALE_AUTHKEY;
const EIP_ALLOCATION_ID = process.env.EIP_ALLOCATION_ID;

console.log(TAILSCALE_AUTHKEY);

export class TailscaleTestCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Service Manager Role
    const ssmRole = new iam.Role(this, 'ssm-role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore'
        )
      ]
    })

    // CDK automatically creates the public / private subnets.
    const vpc = new ec2.Vpc(this, "vpc");

    // instance initial setup
    const userData = ec2.UserData.forLinux({shebang: '#!/bin/bash'});
    userData.addCommands(
      'sudo yum install yum-utils',
      'sudo yum-config-manager -y --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2/tailscale.repo',
      'sudo yum install -y tailscale',
      "echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf",
      "echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf",
      'sudo sysctl -p /etc/sysctl.d/99-tailscale.conf',
      'sudo tailscale set --advertise-exit-node --advertise-connector',
      'sudo systemctl enable --now tailscaled',
      `sudo tailscale up --authkey ${TAILSCALE_AUTHKEY}`
    );

    const instance = new ec2.Instance(this, "tailscale-instance", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
      }),
      vpc: vpc,
      role: ssmRole,
      associatePublicIpAddress: true,
      sourceDestCheck: false,
      vpcSubnets: vpc.selectSubnets({subnetType: ec2.SubnetType.PUBLIC}),
      userData: userData
    });

    // associate the allocated Elastic IP with the instance
    new ec2.CfnEIPAssociation(this, "static ip", {
      allocationId: EIP_ALLOCATION_ID,
      instanceId: instance.instanceId
    })

  }
}
