output "ecr_repository_url" {
  description = "ECR repository URL for the app image (<acct>.dkr.ecr.<region>.amazonaws.com/<repo>). The deploy executor tags/pushes to this."
  value       = aws_ecr_repository.this.repository_url
}

output "alb_dns_name" {
  description = "Public DNS name of the ALB. The deploy executor forms the service URL as http://<alb_dns_name>."
  value       = aws_lb.this.dns_name
}
