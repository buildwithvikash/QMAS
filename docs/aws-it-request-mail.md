**To:** IT Infrastructure / Cloud Team
**Cc:** IQC Head, QMAS Project Lead
**Subject:** Request for AWS setup for the QMAS application (Incoming Material Inspection & Defect Notification)

---

Dear IT Team,

The QMAS application (Incoming Material Inspection, Deviation and Defect Notification / CAPA) has finished development (Sprints A–E). We now need AWS resources to host it, starting with the **Dev / UAT** environment and then **Production**. Please arrange the setup below in our existing **AWS Mumbai (ap-south-1)** account.

### 1. Application summary

| Item | Detail |
|---|---|
| Application | QMAS – web app plus API in **one Docker image** (Node.js 22, PostgreSQL) |
| Users | About 200 at the same time, across 7 plants (1111, 1115, 1125, 1120, 1191, 1130, 1179) |
| Access | Desktop browsers and Android tablets (an installable web app that also works offline) on the company network |
| Container port | **4000** (HTTP), health check at **`GET /api/v1/health`** |
| Processes | **API** (`node backend/src/server.js`) and a **background worker** (`node backend/src/worker.js`) for SAP sync, timers, CAPA reminders and mail. Both run from the same image |
| Database migrations | One-off task before each release: `node backend/scripts/migrate.js` |

### 2. AWS services needed

| # | Service | Configuration requested (Prod; Dev/UAT can be smaller) |
|---|---|---|
| 1 | **VPC** | 2 Availability Zones; public subnets (ALB only) and private subnets (ECS, RDS); NAT Gateway for outbound traffic |
| 2 | **ECR** | One private repository `qmas`, with scan on push |
| 3 | **ECS Fargate** | Cluster `qmas`. **API service:** 2 tasks minimum (auto-scale to 4), 1 vCPU / 2 GB each. **Worker service:** exactly 1 task, 0.5 vCPU / 1 GB |
| 4 | **Application Load Balancer** | Internet-facing, HTTPS 443 → target group on port 4000, health check `/api/v1/health`, idle timeout **120 s** (Excel reports and PDFs), HTTP → HTTPS redirect |
| 5 | **CloudFront + AWS WAF** | CloudFront in front of the ALB; origin timeout **60 s**; allow all HTTP methods and forward cookies; WAF with the AWS managed rules (Core, Known Bad Inputs, IP reputation) and a rate limit |
| 6 | **RDS for PostgreSQL 17** | **Multi-AZ**, `db.m7g.large` (Dev: `db.t4g.medium`, single-AZ is fine), 100 GB gp3 with storage auto-scaling, encrypted (KMS), SSL required. Extensions: `pgcrypto`, `pg_trgm`, `citext`. Automated backups with **PITR for 35 days**, monthly snapshots copied to a second region, Performance Insights on |
| 7 | **S3** | Bucket for photos and PDFs (inspection photos, DN/CAPA evidence, support screenshots): private, Block Public Access, **versioning**, SSE-KMS, accessed only by the ECS task role. Uploads are up to 25 MB per request |
| 8 | **Amazon SES** | Production access (out of sandbox), verified domain with DKIM/SPF/DMARC, sender `no-reply@<company-domain>`, **SMTP credentials** (port 587, STARTTLS) |
| 9 | **Secrets Manager** | Secrets for: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `SMTP_USER`, `SMTP_PASS`, `SAP_API_USER`, `SAP_API_PASSWORD` |
| 10 | **Site-to-site VPN** | Use the existing plant ↔ AWS VPN so the **worker** can reach the SAP QA32 API (read only, HTTPS). We need the SAP API host/port opened from the private subnets |
| 11 | **CloudWatch** | Log group `/ecs/qmas` (90-day retention), Container Insights; alarms for ALB 5xx, latency, unhealthy hosts, ECS task stopped, RDS CPU / free storage / connections, with notifications to the IT and QMAS support mailbox (SNS) |
| 12 | **ACM + DNS** | Domain such as **`qmas.<company-domain>`**; ACM certificate (in **us-east-1** for CloudFront, and in ap-south-1 for the ALB); DNS record pointing to CloudFront |
| 13 | **IAM** | ECS task execution role (ECR pull, Secrets Manager read, CloudWatch logs); task role (S3 read/write on the QMAS bucket only); a CI/CD deploy role for GitHub Actions (OIDC) to push to ECR and update ECS |

### 3. Security groups and network

- **ALB SG:** inbound 443 from CloudFront only (AWS managed prefix list `com.amazonaws.global.cloudfront.origin-facing`).
- **ECS SG:** inbound 4000 from the ALB SG only.
- **RDS SG:** inbound 5432 from the ECS SG only (plus a bastion host or SSM Session Manager for DBA access).
- **Outbound from ECS:** SES SMTP (587), S3 / Secrets Manager / ECR (VPC endpoints preferred), SAP API over the VPN.
- **Company public IPs:** please share the company's **public (egress) IP addresses** for all plants and offices. QMAS allows sign-in only from the company network, and these addresses are entered under *Administration → Network Access*. They can also be added as a WAF IP set if IT wants a second layer.

### 4. Environment variables (set in the ECS task definition)

```
NODE_ENV=production
PORT=4000
SERVE_WEB_DIST=/app/frontend/dist
DB_SSL=true
DB_POOL_MAX=30
COOKIE_SECURE=true
TRUST_PROXY=2                # CloudFront + ALB
LOG_TO_FILE=false            # CloudWatch collects stdout
LOG_LEVEL=info
MAIL_TRANSPORT=smtp
MAIL_FROM=QMAS <no-reply@<company-domain>>
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SAP_MODE=api
SAP_API_URL=<to be shared by the SAP team>
SAP_SYNC_INTERVAL_MIN=15
APP_BASE_URL=https://qmas.<company-domain>
# Secrets Manager: DATABASE_URL, JWT_ACCESS_SECRET, SMTP_USER, SMTP_PASS, SAP_API_USER, SAP_API_PASSWORD
```

### 5. Environments

| Environment | Purpose | Notes |
|---|---|---|
| Dev / UAT | Testing and UAT at the pilot plant | Smaller sizes, single-AZ RDS allowed |
| Production | Live use, rolled out plant by plant | Sizes as in section 2, Multi-AZ |

Separate accounts are preferred; if that is not possible, separate VPCs or clear tagging (`Project=QMAS`, `Environment=dev|uat|prod`) is fine.

### 6. What we need back from IT

1. AWS account / environment details and console access (IAM Identity Center) for the QMAS team.
2. ECR repository URI and the GitHub Actions deploy role ARN.
3. RDS endpoint and the Secrets Manager ARNs.
4. S3 bucket name.
5. SES SMTP credentials (stored in Secrets Manager) and the verified sender address.
6. Final domain name and certificate status.
7. Confirmation that the VPN route to the SAP API is open, and the list of company public IPs.

### 7. Notes

- Photos and PDFs are stored on local disk today. The S3 adapter is being added before go-live; until then, Dev can use an EFS volume mounted at `UPLOAD_DIR` if needed.
- Nothing is written back to SAP; QMAS only reads QA32 inspection lots.
- The worker must run as **exactly one** task; the API can scale out.

If anything here needs to change to fit our cloud standards, please let us know. We are happy to have a short call to go through it.

Thanks and regards,
**[Your Name]**
[Designation], QMAS Project
[Phone] | [Email]
