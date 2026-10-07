# TCP protocol v1

Each message has a four-byte unsigned big-endian payload length followed by UTF-8 JSON. Length must be 1..1048576. Decoder accepts fragmented/coalesced frames. Client sends hello before any query: {"type":"hello","id":1,"version":1,"user":"admin","password":"...","database":"main"}. Then {"type":"query","id":2,"sql":"SELECT * FROM t WHERE id = ?","params":[1]}. Close message is {"type":"close","id":3}.

Server replies with {id,ok:true,result:{rows,affected,plan,timeMs}} or {id,ok:false,error:{code,message}}. Successful hello returns version/database. BIGINT values use {"$bigint":"123"}; BLOBs use {"$blob":"base64"}. Ordinary objects are not SQL parameter values. Queries support bound parameters but are parsed each time; named prepare/execute/deallocate is not implemented. One configured database is exposed as main. There is no protocol encryption or transport negotiation.
