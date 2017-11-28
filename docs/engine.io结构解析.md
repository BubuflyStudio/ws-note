# engine.io 的结构解析
作为 socket.io 的构建基础 engine.io 主要负责对底层接口的抽象封装，从而使得 websocket 
的通讯使用更为方便。而 socket.io 则在 engine.io 的基础上添加了一些业务逻辑的封装（房间
概念等）。

由于 engine.io 的实现策略的缘由，使得其在做多节点的支持时对 `ip hash` 特性有较强的依赖，
这里通过对 engine.io 的实现策略调整从而使之摆脱对 `ip hash` 的依赖。

