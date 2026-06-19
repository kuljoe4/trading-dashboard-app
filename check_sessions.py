import json
import sqlite3

# Looking for how to check the database
# I'll search for the sqlite database file
import os
for root, dirs, files in os.walk("."):
    for file in files:
        if file.endswith(".sqlite") or file.endswith(".db"):
            print(os.path.join(root, file))
