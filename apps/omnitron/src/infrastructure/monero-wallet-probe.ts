/** Each read stays on its authenticated socket on the registered node. */
export const MONERO_WALLET_PROBE = String.raw`import hashlib, http.client, ipaddress, json, os, re, stat, subprocess, sys, time
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
def ledger_addresses(nonce,members):
    require(re.fullmatch('[0-9a-f]{64}',nonce) and 0<len(members)<=256)
    flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK
    with os.fdopen(os.open('/run/omnitron-wallet-members-'+nonce,flags),'rb') as ledger:
        info=os.fstat(ledger.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1)
        require(0<=time.time()-info.st_mtime<=900 and info.st_size==96*len(members))
        content=ledger.read(96*len(members)+1)
    require(len(content)==96*len(members) and content.endswith(b'\n'))
    rows=content[:-1].decode('ascii').split('\n')
    require(len(rows)==len(members) and all(re.fullmatch('8[1-9A-HJ-NP-Za-km-z]{94}',row) for row in rows))
    by_member={digest(nonce+':'+row):row for row in rows}
    require(set(by_member)==set(members))
    return by_member
def wallet_call(identity,unit,port,declared_host,method,params):
    require(method in ('get_address','get_address_index','get_accounts') and socket_identity(unit,port,declared_host)==identity)
    rpc=http.client.HTTPConnection(identity[1],port,timeout=12)
    body=json.dumps({'jsonrpc':'2.0','id':'owned','method':method,'params':params},separators=(',',':')).encode('ascii')
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
        require(reply.get('jsonrpc')=='2.0' and reply.get('id')=='owned' and ('result' in reply)!=('error' in reply))
        require(socket_identity(unit,port,declared_host)==identity)
        return reply
    finally:
        rpc.close()
def uint32(value):
    return type(value) is int and 0<=value<=4294967295
def read_account(call,major):
    reply=call('get_address',{'account_index':major})
    if 'error' in reply:
        # Monero may recognize a lookahead key beyond the last materialized account.
        require(major>0 and reply['error'].get('code')==-14)
        return {}
    result=reply['result']; rows=result['addresses']; by_index={}; distinct=set()
    require(isinstance(rows,list))
    for row in rows:
        index,address=row['address_index'],row['address']
        require(uint32(index) and index not in by_index and address not in distinct)
        require(re.fullmatch(('4' if (major,index)==(0,0) else '8')+'[1-9A-HJ-NP-Za-km-z]{94}',address))
        by_index[index]=address; distinct.add(address)
    require(0 in by_index and by_index[0]==result['address'])
    return by_index
def membership(call,nonce,members,ledger):
    first=read_account(call,0)
    primary=first[0]
    known={digest(nonce+':'+address) for minor,address in first.items() if minor!=0}
    matched=set(members).intersection(known)
    receipt={'primarySha256':digest(json.dumps(['xmr-mainnet-primary-v1',primary],separators=(',',':'))),'checked':len(members)}
    if ledger is not None:
        unresolved={}
        for member in sorted(set(members)-matched):
            address=ledger[member]
            reply=call('get_address_index',{'address':address})
            if 'error' in reply:
                require(reply['error'].get('code')==-2 and reply['error'].get('message')=="Address doesn't belong to the wallet")
                continue
            index=reply['result']['index']; major,minor=index['major'],index['minor']
            require(uint32(major) and uint32(minor))
            unresolved.setdefault(major,[]).append((minor,member))
        index_only=0; other_matches=0; roots={0:primary}
        for major,rows in unresolved.items():
            issued=first if major==0 else read_account(call,major)
            for minor,member in rows:
                if minor not in issued:
                    index_only+=1
                elif issued[minor]==ledger[member]:
                    matched.add(member)
                    if major!=0:
                        other_matches+=1
                        roots[major]=issued[0]
                else:
                    # A spend-key lookup alone does not verify the full receiving address.
                    raise ValueError()
        if other_matches:
            # One response must bind all matched account roots to the original primary.
            accounts=call('get_accounts',{})['result']['subaddress_accounts']
            observed={row['account_index']:row['base_address'] for row in accounts}
            require(len(observed)==len(accounts) and all(observed.get(i)==address for i,address in roots.items()))
        else:
            last=call('get_address',{'account_index':0,'address_index':[0]})['result']
            require(last['address']==primary and len(last['addresses'])==1 and last['addresses'][0]['address_index']==0 and last['addresses'][0]['address']==primary)
        receipt['indexed']={'indexOnly':index_only,'otherAccountMatches':other_matches,
                            'matchedSetSha256':digest(json.dumps([nonce,sorted(matched)],separators=(',',':')))}
    return {**receipt,'matched':len(matched)}
def main():
    q=json.loads(sys.stdin.buffer.readline(650000))
    unit,port,nonce,members=q['unit'],q['port'],q['nonce'],q['members']
    require(re.fullmatch('[0-9a-f]{64}',nonce) and 0<len(members)<=8192 and len(set(members))==len(members))
    require(all(re.fullmatch('[0-9a-f]{64}',m) for m in members) and q.get('lookup') in (None,'node-ledger'))
    ledger=ledger_addresses(nonce,members) if q.get('lookup')=='node-ledger' else None
    declared_host=q.get('host')
    identity=socket_identity(unit,port,declared_host)
    def call(method,params):
        return wallet_call(identity,unit,port,declared_host,method,params)
    output(membership(call,nonce,members,ledger))
if __name__=='__main__':
    try:
        main()
    except Exception:
        sys.exit(1)`;
