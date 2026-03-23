p='/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
c=open(p).read()
c=c.replace("PORT: '3000'","PORT: '3001'",1)
open(p,'w').write(c)
print('PORT fixed to 3001')
