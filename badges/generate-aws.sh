#!/bin/sh
# Regenerates badges/aws.svg.
#
# Simple Icons removed all Amazon marks (trademark request), so shields.io no
# longer resolves `logo=amazonwebservices`. We embed the last published icon as
# a base64 data URI and commit the rendered badge instead.
set -eu
cd "$(dirname "$0")"

MESSAGE=Competent
COLOR=brightgreen

logo=$(
  curl -fsSL https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/amazonwebservices.svg \
    | sed 's|<title>[^<]*</title>||; s|<svg |<svg fill="white" |' \
    | base64 | tr -d '\n' | sed 's/+/%2B/g; s|/|%2F|g; s/=/%3D/g'
)

curl -fsSL -o aws.svg "https://img.shields.io/static/v1?label=%E2%80%8B&message=$MESSAGE&color=$COLOR&style=flat-square&logo=data:image/svg%2Bxml;base64,$logo"
