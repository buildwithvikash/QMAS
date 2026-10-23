**Subject:** Request for AWS Setup – QMAS Application

Dear IT Team,

We have finished development of the QMAS application (Incoming Material Inspection, Deviation and Defect Notification / CAPA). We now need AWS resources to host it. Please set up the following in our existing AWS Mumbai (ap-south-1) account, first for Dev/UAT and then for Production.

**Application details**
- A Node.js 22 application. One Node.js process serves the web app and the API on port 4000. The health check is at /api/v1/health.
- A background worker (a second Node.js process from the same code) handles SAP sync, reminders and e-mail. It must run on one server only.
- About 200 users at the same time across 7 plants, on desktop browsers and Android tablets.
- No Docker. The application runs directly on the servers, managed by PM2 with Nginx in front.

**AWS services required**
1. **VPC:** 2 Availability Zones, public subnets for the load balancer, private subnets for the application servers and database, and a NAT Gateway.
2. **EC2 application servers:** 2 instances (m7i.large – 2 vCPU / 8 GB, 50 GB gp3 each), one in each Availability Zone, in the private subnets. Ubuntu 24.04 LTS or Amazon Linux 2023, with Node.js 22, PM2 and Nginx installed. For Dev/UAT, 1 instance (t3.large) is enough.
3. **Application Load Balancer:** HTTPS (443) to port 4000 on both servers, with an idle timeout of 120 seconds.
4. **CloudFront and AWS WAF:** in front of the load balancer, with the AWS managed rules and a rate limit.
5. **RDS PostgreSQL 17:** Multi-AZ, db.m7g.large (db.t4g.medium for Dev), 100 GB gp3 storage with auto-scaling, encryption and SSL. Extensions: pgcrypto, pg_trgm, citext. Automated backups kept for 35 days.
6. **S3:** a private, encrypted bucket with versioning for inspection photos and PDFs. Both servers must see the same files. If S3 can't be set up in time, please provide an EFS volume mounted on both servers instead.
7. **Amazon SES:** production access, a verified company domain, and SMTP credentials for no-reply@<company-domain>.
8. **Secrets Manager:** to store the database URL, the JWT secret, the SMTP credentials and the SAP API credentials.
9. **Site-to-site VPN:** access from the application servers to the SAP QA32 API over the existing plant–AWS VPN. QMAS only reads from SAP.
10. **CloudWatch:** the CloudWatch agent on both servers for logs and metrics, and alarms (errors, CPU, memory, disk, database storage), with alerts sent to IT and the QMAS team.
11. **Domain and SSL:** qmas.<company-domain>, with ACM certificates for CloudFront and the load balancer.
12. **Server access:** access to the servers through AWS Systems Manager (Session Manager), for deployments and support. An IAM role on the servers to read the secrets, use the S3 bucket and send logs to CloudWatch.
13. **Backups:** daily AMI or EBS snapshots of the application servers.

**What we need from IT**
- AWS console access for the QMAS team
- Server details and Session Manager access
- RDS endpoint and the Secrets Manager details
- S3 bucket name (or EFS details)
- SES SMTP credentials and the verified sender address
- The final domain name
- Confirmation that the VPN connection to the SAP API is open
- The company's public (internet) IP addresses for all plants and offices. QMAS only allows sign-in from the company network, so we need these addresses to allow our users in.

If any of this needs to change to fit our cloud standards, please let us know. We are happy to discuss it on a call.

Thanks and regards,
[Your Name]
[Designation]
[Contact Number]
