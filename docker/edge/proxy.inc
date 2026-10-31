# Variable upstream + resolver: re-resolve `api` so a recreated container (new IP) needs no edge restart.
set $api_upstream http://api:3001;
proxy_pass $api_upstream;
proxy_set_header Host $host;
# Overwrite (never append) so a client cannot spoof the address the API rate-limits on.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
