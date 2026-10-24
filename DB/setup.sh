#!/bin/bash
# ============================================
# Skill Credentials: PostgreSQL setup (Ubuntu)
# ============================================
 
# Step 1: Install PostgreSQL
sudo apt update
sudo apt install -y postgresql postgresql-contrib
 
# Step 2: Start the service
sudo systemctl start postgresql
sudo systemctl enable postgresql
 
# Step 3: Create a database user and database
# (runs as the postgres superuser)
sudo -u postgres psql <<EOF
CREATE USER hei_admin WITH PASSWORD 'hei_local';
CREATE DATABASE hei_ecosystem OWNER hei_admin;
GRANT ALL PRIVILEGES ON DATABASE hei_ecosystem TO hei_admin;
-- The full mode of the replay (yarn replay:full) recreates its tables here.
CREATE DATABASE hei_replay OWNER hei_admin;
EOF
 
echo "PostgreSQL installed and database created."
echo ""
echo "Connect with:"
echo "  psql -U hei_admin -d hei_ecosystem -h localhost"
echo ""
echo "Next: run the schema file:"
echo "  psql -U hei_admin -d hei_ecosystem -h localhost -f schema.sql"
