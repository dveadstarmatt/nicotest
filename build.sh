#!/bin/bash
set -e

echo "Installing Python packages..."
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt

echo "Build completed successfully!"
