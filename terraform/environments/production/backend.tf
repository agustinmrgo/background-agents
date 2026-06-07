# Terraform State Backend Configuration
# Uses an S3-compatible object store for Terraform state.
# This checkout is configured for Supabase Storage S3 in backend.tfvars.
#
# Prerequisites:
# 1. Create a private Supabase Storage bucket: open-inspect-terraform-state
# 2. Enable Storage S3 and generate S3 access keys in the Supabase dashboard
# 3. Initialize with:
#    terraform init \
#      -backend-config=backend.tfvars
#
# Or create a backend.tfvars file (gitignored) with:
#   access_key     = "your-supabase-s3-access-key-id"
#   secret_key     = "your-supabase-s3-secret-access-key"
#   region         = "your-project-region"
#   endpoints      = { s3 = "https://<project-ref>.storage.supabase.co/storage/v1/s3" }
#   use_path_style = true
#
# Then run: terraform init -backend-config=backend.tfvars

terraform {
  backend "s3" {
    bucket = "open-inspect-terraform-state"
    key    = "production/terraform.tfstate"

    # All sensitive/account-specific values passed via -backend-config
    # endpoints = { s3 = "https://<PROJECT_REF>.storage.supabase.co/storage/v1/s3" }
    # region = "..."
    # access_key = "..."
    # secret_key = "..."

    # Required for S3-compatible backends such as Supabase Storage.
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
