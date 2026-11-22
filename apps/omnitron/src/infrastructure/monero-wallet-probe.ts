/** Executed on the registered Linux node. It owns one HTTP connection from the
 * challenge to the reply. The controlling service sends only the Digest response. */
export const MONERO_WALLET_PROBE = String.raw`import hashlib, http.client, ipaddress, json, os, re, subprocess, sys
def require(condition):
    if not condition:
        raise ValueError()
def output(obj):
    print(json.dumps(obj,separators=(',',':')),flush=True)
def command(*args):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=5,text=True).stdout.strip()
def digest(value):
    return hashlib.sha256(value.encode('ascii')).hexdigest()
def socket_identity(unit,port,declared_host=None):
    require(unit in ('monero-wallet-rpc.service','monero-walletd.service') and type(port) is int and 0<port<65536)
    pid=int(command('systemctl','show',unit,'-p','MainPID','--value'))
    require(pid>1 and os.path.basename(os.readlink('/proc/%d/exe'%pid))=='monero-wallet-rpc')
    sockets=command('ss','-H','-ltnp','sport = :%d'%port).splitlines()
    require(len(sockets)==1 and set(re.findall(r'\bpid=(\d+)\b',sockets[0]))=={str(pid)})
    host=sockets[0].split()[3].rsplit(':',1)[0].strip('[]')
    bound=None if host=='*' else ipaddress.ip_address(host)
    if declared_host is not None:
        addr=ipaddress.ip_address(declared_host)
        require('%' not in declared_host and not addr.is_unspecified and not addr.is_multicast)
        require(bound is None or bound==addr or (bound.is_unspecified and bound.version==addr.version))
    elif bound is None or bound.is_unspecified:
        addr=ipaddress.ip_address('::1' if bound and bound.version==6 else '127.0.0.1')
    else:
        addr=bound
    if not addr.is_loopback:
        routes=json.loads(command('ip','-j',('-4' if addr.version==4 else '-6'),'route','get',str(addr)))
        require(len(routes)==1 and routes[0].get('dev')=='lo' and routes[0].get('type')=='local')
    return (pid,str(addr))
def main():
    q=json.loads(sys.stdin.buffer.readline(650000))
    unit,port,nonce,members=q['unit'],q['port'],q['nonce'],q['members']
    require(re.fullmatch('[0-9a-f]{64}',nonce) and 0<len(members)<=8192 and len(set(members))==len(members))
    require(all(re.fullmatch('[0-9a-f]{64}',m) for m in members))
    declared_host=q.get('host')
    identity=socket_identity(unit,port,declared_host)
    rpc=http.client.HTTPConnection(identity[1],port,timeout=12)
    body=b'{"jsonrpc":"2.0","id":"owned","method":"get_address","params":{"account_index":0}}'
    headers={'Content-Type':'application/json','Connection':'keep-alive'}
    try:
        rpc.request('POST','/json_rpc',body,headers)
        sock=rpc.sock
        first=rpc.getresponse()
        require(first.status==401 and not first.will_close and len(first.read(4097))<=4096)
        challenges=first.headers.get_all('WWW-Authenticate',[])
        require(0<len(challenges)<=8)
        offered={}
        for candidate in challenges:
            if len(candidate)>2048 or not re.match(r'^Digest ',candidate,re.I) or re.search(r'[\x00-\x1f\x7f]',candidate): continue
            field=re.search(r'(?:^|,)\s*algorithm\s*=\s*"?([\w-]+)"?(?:\s*,|\s*$)',candidate[7:],re.I)
            algorithm=field.group(1).upper() if field else 'MD5'
            if algorithm in ('MD5','MD5-SESS'): offered[algorithm]=candidate
        challenge=offered.get('MD5-SESS') or offered.get('MD5')
        require(challenge)
        output({'challenge':challenge})
        auth=json.loads(sys.stdin.buffer.readline(4096))
        require(isinstance(auth,str) and auth.startswith('Digest ') and not re.search(r'[\x00-\x1f\x7f]',auth))
        require(rpc.sock is sock and sock is not None and socket_identity(unit,port,declared_host)==identity)
        rpc.request('POST','/json_rpc',body,{**headers,'Authorization':auth})
        second=rpc.getresponse()
        require(second.status==200)
        payload=second.read(8*1024*1024+1)
        require(len(payload)<=8*1024*1024)
        reply=json.loads(payload)
        require(reply.get('jsonrpc')=='2.0' and reply.get('id')=='owned' and 'error' not in reply)
        result=reply['result']; primary=result['address']; rows=result['addresses']
        require(re.fullmatch('4[1-9A-HJ-NP-Za-km-z]{94}',primary) and isinstance(rows,list))
        seen_indices=set(); addresses=set(); zero=None
        for row in rows:
            index,address=row['address_index'],row['address']
            require(type(index) is int and 0<=index<=4294967295 and index not in seen_indices and address not in addresses)
            require(re.fullmatch(('4' if index==0 else '8')+'[1-9A-HJ-NP-Za-km-z]{94}',address))
            seen_indices.add(index); addresses.add(address)
            if index==0: zero=address
        require(zero==primary and socket_identity(unit,port,declared_host)==identity)
        owned={digest(nonce+':'+address) for address in addresses if address!=primary}
        output({'primarySha256':digest(json.dumps(['xmr-mainnet-primary-v1',primary],separators=(',',':'))),
                'checked':len(members),'matched':len(owned.intersection(members))})
    finally:
        rpc.close()
if __name__=='__main__':
    try:
        main()
    except Exception:
        sys.exit(1)`;
