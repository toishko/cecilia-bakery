import json
import urllib.request

url = "https://dykztphptnytbihpavpa.supabase.co/rest/v1/driver_inventory?select=*"
headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w"
}
req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as response:
    print(response.read().decode('utf-8'))
