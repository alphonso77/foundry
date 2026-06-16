variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "desired_count" {
  description = "Number of ECS task replicas."
  type        = number
  default     = 1
}
