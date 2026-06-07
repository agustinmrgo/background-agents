#!/usr/bin/env python3
"""Create the private Supabase Storage S3 media bucket for Open-Inspect.

Reads S3 credentials/endpoint from the local (gitignored) backend.tfvars so no
secrets are embedded on the command line. Idempotent.
"""
import re
import pathlib
import boto3
import botocore

here = pathlib.Path(__file__).resolve().parent.parent
backend = (here / "backend.tfvars").read_text()


def val(key):
    m = re.search(rf'^{key}\s*=\s*"([^"]+)"', backend, re.M)
    if not m:
        raise SystemExit(f"missing {key} in backend.tfvars")
    return m.group(1)


endpoint_m = re.search(r's3\s*=\s*"([^"]+)"', backend)
if not endpoint_m:
    raise SystemExit("missing endpoints.s3 in backend.tfvars")

s3 = boto3.client(
    "s3",
    endpoint_url=endpoint_m.group(1),
    region_name=val("region"),
    aws_access_key_id=val("access_key"),
    aws_secret_access_key=val("secret_key"),
)

bucket = "open-inspect-media"
try:
    s3.create_bucket(Bucket=bucket)
    print("created", bucket)
except botocore.exceptions.ClientError as e:
    code = e.response["Error"].get("Code")
    if code in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
        print("exists", bucket)
    else:
        raise

print("buckets:", [x["Name"] for x in s3.list_buckets().get("Buckets", [])])
