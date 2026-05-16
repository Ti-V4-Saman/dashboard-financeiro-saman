import os
from dotenv import load_dotenv
load_dotenv()
from etl.db import get_connection
conn = get_connection()
with conn.cursor() as cur:
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'ca' AND table_name = 'produtos'
        ORDER BY ordinal_position
    """)
    rows = cur.fetchall()
    print("SCHEMA ca.produtos:")
    for row in rows:
        print(f"  {row[0]}: {row[1]}")
conn.close()
