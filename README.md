
#### 初始化
go mod init geo-go

#### mod依赖
go get github.com/lib/pq
go get github.com/redis/go-redis/v9

#### 测试：
运行代码：在终端输入 go run main.go。

打开浏览器，输入：
http://localhost:8080/update?id=floder_01&lng=116.40&lat=39.90
页面显示 OK! 说明数据已经进去了。

再开一个页面，输入：
http://localhost:8080/nearby?lng=116.401&lat=39.901
你会看到：附近结果： - floder_01: 0.14 km。

查看 Redis（实时）：
在终端输入 docker exec -it my-redis redis-cli GEOPOS drivers_realtime floder_01。

查看 PostGIS（硬盘）：
在终端输入 docker exec -it my-postgis psql -U postgres -c "SELECT name, ST_AsText(geom) FROM drivers;"。