import sys, struct
KEY=b"FUCKBAUEREWALD"
def xor(b): return bytes(c ^ KEY[i % len(KEY)] for i,c in enumerate(b))
def tpwm(a):
    if a[:4]!=b"TPWM": return a
    orglen=struct.unpack_from("<I",a,4)[0]
    if orglen>len(a)*10: return xor(a[4:])
    out=bytearray(); p=8; n=len(a)
    while p<n:
        mask=a[p]; p+=1; b=256
        while p<n and b>1:
            b//=2
            if not (mask & b):
                out.append(a[p]); p+=1
            else:
                c=a[p]; p+=1; q=len(out)-a[p]
                if c<16: cnt=c+3
                else: q-=256*(c>>4); cnt=(c&15)+3
                for k in range(cnt): out.append(out[q+k])
                p+=1
    return bytes(out[:orglen])
if __name__=="__main__":
    d=tpwm(open(sys.argv[1],"rb").read())
    sys.stdout.buffer.write(d)
