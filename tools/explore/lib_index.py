import sys, struct, collections
for fn in sys.argv[1:]:
    a=open(fn,"rb").read()
    if a[:4]==b"TPWM": print(fn,"TPWM whole-file"); continue
    pidx=struct.unpack_from("<I",a,0)[0]
    n=(len(a)-pidx)//12
    ents=[]
    for i in range(n):
        name=a[pidx+i*12:pidx+i*12+8]; off=struct.unpack_from("<I",a,pidx+i*12+8)[0]
        ents.append((name,off))
    sizes=[(ents[i+1][1] if i+1<n else pidx)-ents[i][1] for i in range(n)]
    heads=collections.Counter(a[o:o+4] for _,o in ents)
    print(f"{fn}: len={len(a)} idx@{pidx} n={n} rem={(len(a)-pidx)%12} sizes[min={min(sizes) if sizes else 0},max={max(sizes) if sizes else 0}] heads={dict(heads.most_common(4))}")
    for i in range(min(3,n)): print("   ",ents[i][0], ents[i][1], sizes[i], a[ents[i][1]:ents[i][1]+24].hex())
