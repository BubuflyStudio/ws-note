# engine.io 的结构解析
作为 socket.io 的构建基础 engine.io 主要负责对底层接口的抽象封装，从而使得 websocket 
的通讯使用更为方便。而 socket.io 则在 engine.io 的基础上添加了一些业务逻辑的封装（房间
概念等）。

由于 engine.io 的实现策略的缘由，使得其在做多节点的支持时对 `ip hash` 特性有较强的依赖，
这里通过对 engine.io 的实现策略调整从而使之摆脱对 `ip hash` 的依赖。

## 简单记录之后规划
`transport.js` 中定义了对 `req` 处理的相关结构，是 `transports` 中的各类方法的基类。
现在需要对 `transports` 中的方法进行重构

## 调试相关
`engine.io` 中使用了 `debug` 做为调试输出，为了方便查看调试信息可在 win 的命令行下设
置环境变量实现输出信息的开关：  
`set DEBUG=*,-not_this` - 输出所有调试信息  
`set DEBUG=engine:ws` - 输出 websocket.js 中的调试信息  
`set DEBUG=null` - 关闭调试信息