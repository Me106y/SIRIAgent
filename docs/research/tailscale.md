# Tailscale 调研

> 调研日期：2026-11-03（Asia/Shanghai）  
> 范围：Tailscale 托管服务（含 Funnel/Serve、ACL、子网路由、Exit Node 等），以及它与本项目 SIRIAgent 现有公网入口的关系。  
> 方法：优先 Tailscale 官方文档、定价页、安全页、Tailscale GitHub、WireGuard 官网；本机 Tailscale 1.98.9 实测。价格、限额、Funnel 限制均以官方页面当日内容为准，页面改版后需重核。

## TL;DR

1. **Tailscale 是一个基于 WireGuard 的 Mesh VPN/零信任覆盖网络**：设备之间直接建加密隧道，打洞失败时走 DERP 中继；不需要在路由器上开入站端口。
2. **控制面与数据面分离**：控制面（coordination server）负责身份、密钥协调、ACL、DNS；真正的业务流量走节点之间的 WireGuard，控制面不承载数据。控制面是闭源的托管服务。
3. **核心能力**：MagicDNS、ACL/grants、Subnet Router、Exit Node、Taildrop、Tailscale SSH、Serve/Funnel、Kubernetes Operator、SSO/SCIM、Tailnet Lock、审计/流日志。适合远程运维、家庭实验室、多集群/多云私网。
4. **安全模型**：数据面端到端加密，官方明确“Tailscale cannot read your traffic”；DERP 只转发已加密的 WireGuard 包；SOC 2 Type II。控制面仍掌握身份、ACL、节点元数据等“控制面信息”。
5. **开源程度**：客户端（daemon/CLI）和 DERP 开源；**托管控制面闭源**。Headscale 是独立的社区自托管控制面，官方明确它“不是 Tailscale 支持的产品”，功能范围更窄，不能当成无缝替代。
6. **定价**：Personal 免费（最多 6 用户、无限设备、3 个 ACL 组、50 个 tagged 资源、每月 1000 分钟 ephemeral）；Standard $8/用户/月；Premium $18/用户/月；Enterprise 定制。价格为 2026-11-03 官方页面。
7. **Funnel 不是 Cloudflare Access 的替代品**：它仍是 beta，公网任何人可访问，只支持 `*.ts.net` 域名、443/8443/10000 端口和 TLS，且有不可配置的带宽限制；不提供 Cloudflare Access 那套身份网关，也没有可配置的 WAF 规则。
8. **对本项目**：2026-11-03 已从 `wonder.zeabur.com` 切到 **`me106y.github`**：Linux 节点 `rog` = `100.81.146.7`，Mac `wei` = `100.108.93.77`；`tailscale ping` 为**直连 20ms**（同一热点），Serve 只配置了 `https://rog.tailc92fe1.ts.net`（8000）；DSH Web 的 8443 已关闭，不再暴露。建议**保留 Cloudflare Tunnel + Access 做公网入口，Tailscale 做内部/管理入口**；不要开 Funnel，也不要把 8000/3080 绑到 `0.0.0.0`。

## 1. 它是什么，不是什么

Tailscale 官方对自己的定位是“把设备、用户和服务连成一个私有网络（tailnet）”，基于 WireGuard，提供身份认证、NAT 穿透、ACL 和 DNS，而不需要传统 VPN 网关或公网 IP。([What is Tailscale?](https://tailscale.com/docs/concepts/what-is-tailscale)、[How Tailscale Works](https://tailscale.com/blog/how-tailscale-works))

它**不是**：

- 不是传统“总部 VPN 集中器”：没有中心数据网关，流量尽量点对点。
- 不是公网反向代理/CDN/WAF：Funnel 只提供很有限的公网暴露能力，见下文“Funnel 的具体限制”。
- 不是零配置的“把 localhost 端口直接暴露给 tailnet”的魔法：服务如果只监听 `127.0.0.1`，tailnet 里访问节点 IP 仍然不通，需要用 Serve 反代或调整监听地址（见 §10）。

## 2. 架构

### 2.1 控制面与数据面

- **控制面（coordination server）**：托管在 `controlplane.tailscale.com`（可自定义），负责设备/用户认证、公钥分发、ACL 策略计算与下发、DNS 配置等。官方说明策略集中存储、由各节点在解密时执行。([How Tailscale Works](https://tailscale.com/blog/how-tailscale-works))
- **数据面**：节点之间的实际流量走 **WireGuard**；能直连就直连，不能直连才走 DERP 中继。([Tailscale encryption](https://tailscale.com/docs/concepts/tailscale-encryption))
- **控制面是闭源的**；客户端和 DERP 开源。([Open source at Tailscale](https://tailscale.com/opensource))

### 2.2 NAT 穿透与 DERP

- 客户端通过 UDP 做路径发现和 NAT 打洞；对称 NAT/严格防火墙下打洞可能失败。
- 失败时回退到 **DERP（Designated Encrypted Relay for Packets）**。DERP 只转发**已经加密**的 WireGuard 包，官方原话是 “DERP servers never access your unencrypted data”。([Tailscale encryption](https://tailscale.com/docs/concepts/tailscale-encryption))
- DERP 服务器列表（DERP map）由控制面下发；客户端按延迟选 home DERP，并把选择告诉控制面，再同步给其他节点。([DERP servers](https://tailscale.com/docs/reference/derp-servers))
- 直连优先，DERP 是兜底；DERP 会增加延迟，且带宽/路径受中继影响。

### 2.3 地址与 DNS

- 每个节点获得 `100.64.0.0/10`（CGNAT 段）内的稳定地址，例如本机切换后的 `100.81.146.7`。([100.x.y.z addresses](https://tailscale.com/kb/1015/100.x-addresses))
- **MagicDNS** 给节点自动分配 `*.ts.net` 名称，tailnet 内可直接用名字访问；也可以配 split DNS/自定义域名。([MagicDNS](https://tailscale.com/docs/features/magicdns))
- 不需要改路由器端口映射；出站 UDP 通就能尝试直连。

## 3. 核心功能

| 功能 | 作用 | 说明/入口 |
| --- | --- | --- |
| ACL / grants | 定义“哪个用户/组/tag 能访问哪个端口” | 策略文件集中管理，节点执行；默认未放行即拒绝。([Access control](https://tailscale.com/docs/features/access-control)) |
| Subnet Router | 把整个 LAN 网段（如 `192.168.1.0/24`）暴露给 tailnet | 节点开 IP 转发、`--advertise-routes`，控制台批准路由；其他设备不用装 Tailscale。([Subnet routers](https://tailscale.com/docs/features/subnet-routers)) |
| Exit Node | 让设备把全部/部分上网流量从某个节点出口 | 适合公共 Wi-Fi、固定出口 IP；需要 `--advertise-exit-node` 和客户端选择。([Exit nodes](https://tailscale.com/docs/features/exit-nodes)) |
| MagicDNS | 自动 DNS 名称 | `https://机器名.tailnet.ts.net`，省去记 IP。([MagicDNS](https://tailscale.com/docs/features/magicdns)) |
| Tailscale SSH | 用身份/ACL 代替 SSH key 登录 | 可配 reauth、check mode、会话录制；需要目标节点启用。([Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)) |
| Taildrop | 设备间传文件 | 类似 AirDrop，走 tailnet。([Taildrop](https://tailscale.com/docs/features/taildrop)) |
| Serve | 把本机服务只暴露给 tailnet | HTTPS + `*.ts.net`，ACL 生效；适合把 `127.0.0.1:8000` 反代给 tailnet。([Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)) |
| Funnel | 把本机服务暴露到公网 | 见下文“Funnel 的具体限制”；beta，限制多，公网任何人可访问。([Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)) |
| Kubernetes Operator | 给 Pod/Service 自动接入 tailnet | 适合跨集群访问。([Kubernetes Operator](https://tailscale.com/docs/kubernetes-operator)) |
| Tailnet Lock | 防止未授权节点公钥注入 tailnet | 可选的额外信任根；会增加密钥管理复杂度。([Tailnet Lock](https://tailscale.com/docs/features/tailnet-lock)) |
| SSO/SCIM/设备审批 | 接 Google/Microsoft/GitHub/OIDC/SAML；SCIM 同步用户/组 | SCIM、设备姿态等从 Standard 起；Premium 有更多治理能力。([Pricing](https://tailscale.com/pricing)) |
| 日志/审计 | 配置审计、网络流日志、日志流 | 网络流日志/日志流在 Premium；审计日志用于变更追踪。([Pricing](https://tailscale.com/pricing)、[Security](https://tailscale.com/security)) |

### Funnel 的具体限制（重要）

官方 Funnel 页面（Last validated: 2026-01-20）明确：

- 目前是 **beta**，所有 plan 可用；
- 允许“**broader internet**”访问，访问者**不需要使用 Tailscale**；
- 只能使用 tailnet 域名（`tailnet-name.ts.net`）；
- 只能监听 **443、8443、10000** 三个端口；
- 只支持 **TLS** 加密连接；
- 流量有**不可配置的带宽限制**；
- 需要平台能运行 Tailscale CLI；
- 同一端口不能同时用于 Serve（仅 tailnet）和 Funnel（公网）；
- Funnel 通过 relay 隐藏设备真实 IP。([Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel))

结论：Funnel 适合临时分享、演示、个人服务；**不适合**作为带 SSO/WAF/DDoS 防护的生产公网入口。它不提供 Cloudflare Access 那种“先登录再放行”的网关能力，也没有可配置的 WAF 规则。

## 4. 计划与价格（2026-11-03 官方页面）

| 计划 | 价格 | 关键限额/能力 |
| --- | --- | --- |
| **Personal** | **$0**，永久免费 | 无限用户设备；最多 **6 用户**；**3 个 ACL 组**；**50 个 tagged 资源**起；每月 **1,000 分钟** ephemeral 资源；可用几乎全部功能。 |
| **Standard** | **$8 / 用户 / 月** | 无限用户；SCIM；**10 个 ACL 组**；1,000 分钟 ephemeral；MDM、设备姿态（EDR/XDR）、高级角色。 |
| **Premium** | **$18 / 用户 / 月** | **300 个 ACL 组**；**10,000 分钟** ephemeral；JIT 访问；高级 Tailscale SSH；网络流日志；日志流；区域路由/流量调度。 |
| **Enterprise** | 定制 | 自定义设备量/限额、专属方案、定制 MSA、自定义 tailnet 子域、发票付款等。 |

来源：[Tailscale Pricing](https://tailscale.com/pricing)。价格为页面标价，未含税/年付差异；采购前需以控制台报价为准。开源项目可申请 Community on GitHub 免费计划，不在本文展开。

## 5. 安全与隐私

- **端到端加密**：所有节点通信（直连或 DERP）都走 WireGuard；官方明确 “Tailscale cannot read your traffic”。([Security](https://tailscale.com/security)、[Tailscale encryption](https://tailscale.com/docs/concepts/tailscale-encryption))
- **控制面**：负责设备协调、认证、ACL 解释、包过滤计算；使用 Noise IK/X25519 等机制；数据面不经过控制面。([Tailscale encryption](https://tailscale.com/docs/concepts/tailscale-encryption)、[How Tailscale Works](https://tailscale.com/blog/how-tailscale-works))
- **DERP**：只处理已加密的 WireGuard 包，不能解密；设备与 DERP 之间还有 NaCl box + TLS 认证。([Tailscale encryption](https://tailscale.com/docs/concepts/tailscale-encryption))
- **合规**：SOC 2 Type II；官方称不存储客户数据、只处理元数据；HIPAA 场景下 Tailscale 认为自身不在 scope、不签 BAA。([Security](https://tailscale.com/security))
- **访问控制**：ACL 默认拒绝；支持 tag、组、端口、autogroup；策略集中管理、节点执行。([Access control](https://tailscale.com/docs/features/access-control))
- **设备侧**：设备审批、密钥过期（key expiry）、Tailnet Lock；服务器节点常用 tag 管理。([Tailnet Lock](https://tailscale.com/docs/features/tailnet-lock))
- **仍要注意的风险**：
  - 控制面/SSO 账号被攻破，攻击者可能改 ACL、加节点；
  - 终端被攻破，Tailscale 不能保护已失陷设备上的数据；
  - 控制面是托管服务，存在可用性与供应商依赖；
  - Funnel 是公网暴露，不能把“有 Tailscale”误当成“有 WAF/Access”。

## 6. 开源与自托管

- **客户端**：核心 daemon/CLI 开源；Linux/Android 客户端完整开源，Windows/macOS 的 GUI 闭源（daemon 开源）。([Open source at Tailscale](https://tailscale.com/opensource))
- **DERP**：开源，可自建 custom DERP（延迟/合规原因）。([Open source at Tailscale](https://tailscale.com/opensource)、[DERP servers](https://tailscale.com/docs/reference/derp-servers))
- **控制面**：**闭源**，是 Tailscale 托管服务的一部分。([Open source at Tailscale](https://tailscale.com/opensource))
- **Headscale**：独立、社区维护的开源控制面实现，面向单 tailnet、自托管/家庭实验室；Tailscale 明确它不是 Tailscale 管理或支持的产品，功能范围更窄。([Open source at Tailscale](https://tailscale.com/opensource)、[Headscale](https://github.com/juanfont/headscale))
- **实践含义**：想完全自托管控制面，只能走 Headscale，但要逐项验证 ACL、SSO、Funnel/Serve、日志、Tailnet Lock 等能力；不要假设“客户端兼容 = 功能完整”。

## 7. 性能与限制

- **直连 vs 中继**：直连性能最好；DERP 会增加 RTT，且带宽受中继和路径影响。对称 NAT、UDP 被封锁、企业防火墙都可能让连接落到 DERP。([DERP servers](https://tailscale.com/docs/reference/derp-servers))
- **Funnel**：beta、三端口、TLS、不可配置带宽限制；不适合大流量/低延迟生产入口。([Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel))
- **控制面依赖**：登录、密钥协调、ACL 更新、DNS 依赖控制面；控制面故障时已建立的直连通常还能跑，但新节点/策略变更会受影响。
- **设备/用户限额**：按 plan 限制（Personal 6 用户、3 ACL 组、50 tagged；Standard/Premium 更多）。([Pricing](https://tailscale.com/pricing))
- **DNS**：MagicDNS 是便利也是依赖；与服务发现/自定义 DNS 混用时要做 split DNS 规划。
- **不是 L7 网关**：ACL 主要管到 L3/L4；没有 WAF、防爬、DDoS 清洗、Bot 管理这类能力；需要这些时仍然要 Cloudflare 或自建网关。
- **MTU/分片**：异常网络（PPPoE、部分移动网络）下可能需要实测/调 MTU；官方客户端默认值以文档为准。

## 8. 与常见方案对比

| 方案 | 定位 | 数据面 | 控制面 | NAT 穿透 | 公网入口 | 身份/ACL | 自托管 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Tailscale** | L3 Mesh VPN/零信任覆盖网 | WireGuard，直连或 DERP | 托管、闭源 | 有（UDP 打洞 + DERP） | Funnel（beta、受限） | SSO + ACL/tag | 控制面不可；客户端/DERP 可；Headscale 第三方 |
| **Cloudflare Tunnel** | 出站连接器 + 公网发布 | QUIC/HTTP2 到 Cloudflare 边缘 | Cloudflare | 不需要（出站） | 原生公网 hostname | Access/SSO、WAF、DDoS | 否（用 Cloudflare） |
| **ZeroTier** | L2 虚拟网络 | 自有协议/UDP | 自建或托管 controller | 有 | 一般不做公网入口 | 网络成员/规则 | 可（controller） |
| **WireGuard** | 点对点 VPN | WireGuard | 无（DIY） | 无（需自己解决） | 自己做端口转发 | 无（靠防火墙） | 完全 |
| **OpenVPN** | 传统 TLS VPN | TLS over UDP/TCP | 自建 | 需公网/端口 | 自建 | 证书/账号 | 完全 |

参考：[Tailscale 对比页](https://tailscale.com/compare)、[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)、[ZeroTier](https://docs.zerotier.com/)、[WireGuard](https://www.wireguard.com/)、[OpenVPN](https://openvpn.net/)。

一句话选型：

- 要“设备之间像在同一局域网 + SSO/ACL + 少运维” → Tailscale。
- 要“把 Web 服务发布到公网 + 登录/WAF/DDoS” → Cloudflare Tunnel + Access。
- 要“完全自托管、二三层可控” → ZeroTier/Headscale/WireGuard，但运维成本更高。

## 9. 适用与不适用

**适合**

- 远程 SSH/数据库/开发机、家庭实验室、NAS、树莓派；
- 多集群/多云/边缘设备的私有互联；
- 小团队替代“买 VPN 网关 + 手动 WireGuard”；
- 需要 SSO、ACL、审计、MagicDNS 的零信任接入；
- 给 CI/CD、K8s Pod 临时接入内网（ephemeral）。

**不适合/需谨慎**

- 面向公众的网站入口，且需要 Access/WAF/DDoS：用 Cloudflare 等；
- 依赖二层广播/组播的网络：ZeroTier 更合适；
- 要求控制面完全自托管且功能对齐托管版：Headscale 需逐项验证；
- 要求极低延迟的实时视频/3D/SSE，而当前只能走远距离 DERP：先解决直连或换入口；
- 把 Funnel 当生产入口：beta + 带宽限制 + 无 WAF。

## 10. 与 SIRIAgent 的关系

### 10.1 现状

**仓库现状**：公网入口是 Cloudflare Tunnel + Access，`siriagent.dpdns.org → 127.0.0.1:8000`，`dsh.siriagent.dpdns.org → 127.0.0.1:3080`；`cloudflared` 在热点/弱网下出现 1033，已有 `cloudflared-healthcheck.timer`。服务本身只绑 `127.0.0.1`。见本仓库 `README.md` 的“Cloudflare 隧道 1033 排障”和 `docs/PHASE2-REQUIREMENTS.md` §1.1。

**本机实测（2026-11-03 11:28，iPhone 热点 172.20.10.x；已切到 `me106y.github`）**：

```text
$ tailscale status
100.81.146.7  rog  Me106y@  linux  -
100.108.93.77 wei  Me106y@  macOS  active; direct 172.20.10.4:41641

$ tailscale ping -c 3 100.108.93.77
pong from wei (100.108.93.77) via 172.20.10.4:41641 in 20ms

$ tailscale serve status
https://rog.tailc92fe1.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:8000
```

- 旧 tailnet `wonder.zeabur.com` 已退出，旧地址 `100.64.1.58` 失效；新节点 key 过期时间 `2027-05-02`。
- Serve 证书已由 Let's Encrypt 签发；本机 `curl --noproxy '*' https://rog.tailc92fe1.ts.net/` 返回 200；DSH Web 的 8443 已关闭。
- 本机 `curl` 不加 `--noproxy` 会走 `127.0.0.1:7890` 代理，对 `*.ts.net` 出现 TLS EOF；Mac 浏览器不受这个代理影响。
- 直连 20ms 说明当前同一热点/LAN 条件下内部访问会明显快于旧的 DERP 260–759ms；跨网/换热点后仍可能回落到 DERP，需要重测。

### 10.2 三个可选方案

| 方案 | 做法 | 优点 | 代价/风险 | 适合 |
| --- | --- | --- | --- | --- |
| **A. 私有管理面 + 保留 Cloudflare 公网** | 保留现有 Tunnel/Access；在主机上用 `tailscale serve` 映射 8000→443，只暴露给 tailnet；DSH Web 不暴露；ACL 只允许指定用户/组访问 `tag:siriagent` 的 443；或用 `tailscale ssh` 做运维 | 不改变公网用户路径；不新增公网暴露；SSO/ACL 可管；可作为 Cloudflare 故障时的备用管理通道 | 管理员设备要装 Tailscale；当前同热点直连 20ms，跨网可能走 DERP；Serve 只开 443，需按 ACL 收紧 | **推荐** |
| **B. Funnel 替代公网入口** | `tailscale funnel 8000` → `https://rog.<tailnet>.ts.net`；或 `funnel 3080` | 不用 cloudflared；自动 TLS；部署快 | beta；公网任何人可访问；无 Access/WAF；只支持 443/8443/10000；带宽限制；中继延迟；域名是 `*.ts.net` | 临时演示/个人服务，**不建议生产** |
| **C. Subnet Router / Exit Node** | 在主机或旁路设备 `--advertise-routes=192.168.x.0/24`，控制台批准；或 `--advertise-exit-node` 让流量从家里出口 | 可访问 LAN 内其他设备；不用每台装客户端；Exit Node 可固定出口 IP | 要开 IP 转发、放行防火墙、批准路由；ACL 配错会扩大访问面；对“只访问本机 127.0.0.1 服务”没有帮助 | 有 LAN 设备/固定出口需求时 |

**关键细节：服务只绑 `127.0.0.1` 时，直接访问 `http://100.81.146.7:8000` 是不通的。** Tailscale 的 100.x 地址是节点网卡地址，不会自动把 `127.0.0.1` 的服务“搬”过去。正确做法是：

- `tailscale serve --bg 8000`：Serve 在 tailnet 侧监听 HTTPS，把请求反代到本机 `127.0.0.1:8000`，ACL 仍然生效；
- 或 `tailscale ssh` 登录主机后 `curl 127.0.0.1:8000`；
- 或临时改服务监听地址（**不建议**，会把服务暴露到更多接口）；
- Subnet Router 也不解决 loopback 服务的问题，它解决的是“LAN 里其他机器”。

### 10.3 建议

1. **公网入口继续用 Cloudflare Tunnel + Access**。Tailscale 的强项是私有 mesh，不是替代 Access/WAF；当前 Cloudflare 的问题（1033）是网络/热点稳定性问题，换 Tailscale 只会把“公网入口”换成“公网 Funnel + 中继延迟”，风险更大。
2. **Tailscale 只做私有运维面**：
   - 用 `tailscale serve` 只把 8000 映射到 443 暴露给 tailnet，DSH Web 保持本地；ACL 限定指定用户/组；
   - 或启用 `tailscale ssh` 做登录，再用 localhost 访问服务；
   - 不要为了“能通”把 8000/3080 绑到 `0.0.0.0`。
3. **不要用 Funnel 裸奔公网演示**。如果确实要临时给外部看，至少加应用层登录/一次性 token，并接受 beta、带宽限制和无 WAF 的风险；长期仍应回到 Cloudflare Access。
4. **继续观察路径质量**：当前同热点直连 20ms；跨网/热点切换后可能回落到 DERP，届时 3D/SSE 会变慢。用 `tailscale ping` 和 `tailscale netcheck` 定期抽查；本机 `curl` 测 `.ts.net` 时记得加 `--noproxy '*'`。
5. **ACL 最小化**：给服务器打 `tag:siriagent`，只允许管理员访问 Serve 的 **443/8443** 和 SSH 的 22；不要把整个 tailnet 默认放行。
6. **不建议**：用 Headscale 直接上生产而不验证 Funnel/Serve/SSO/日志；把 Tailscale 当 WAF/DDoS 防护；把 Funnel 当 Cloudflare Access 的等价替代。

## 11. 结论

Tailscale 是“私有网络 + 身份 + ACL”的优秀工具，特别适合运维、家庭实验室、多集群互联；它的公网能力（Funnel）是有限、beta、无企业网关能力的。对 SIRIAgent 来说，最稳的架构是 **Cloudflare Tunnel/Access 负责公网演示，Tailscale 负责私有管理面/备用通道**；当前这台机器已切到 `me106y.github`，同热点直连 20ms，Serve 已配好；跨网仍可能走 DERP，需要持续观察。

## 12. 来源

均为 2026-11-03 访问；标注“Last validated”的页面以官方标注为准。

1. [What is Tailscale?](https://tailscale.com/docs/concepts/what-is-tailscale)
2. [How Tailscale Works](https://tailscale.com/blog/how-tailscale-works)
3. [Tailscale encryption](https://tailscale.com/docs/concepts/tailscale-encryption)（Last validated: 2026-01-07）
4. [DERP servers](https://tailscale.com/docs/reference/derp-servers)（Last validated: 2026-01-21）
5. [100.x.y.z addresses](https://tailscale.com/kb/1015/100.x-addresses)
6. [Tailscale Pricing](https://tailscale.com/pricing)
7. [Open source at Tailscale](https://tailscale.com/opensource)
8. [Tailscale Security](https://tailscale.com/security)
9. [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)（Last validated: 2026-01-20，beta）
10. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
11. [Access control](https://tailscale.com/docs/features/access-control)
12. [Subnet routers](https://tailscale.com/docs/features/subnet-routers)
13. [Exit nodes](https://tailscale.com/docs/features/exit-nodes)
14. [MagicDNS](https://tailscale.com/docs/features/magicdns)
15. [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
16. [Taildrop](https://tailscale.com/docs/features/taildrop)
17. [Tailnet Lock](https://tailscale.com/docs/features/tailnet-lock)
18. [Kubernetes Operator](https://tailscale.com/docs/kubernetes-operator)
19. [Tailscale GitHub](https://github.com/tailscale/tailscale)
20. [Headscale](https://github.com/juanfont/headscale)
21. [WireGuard](https://www.wireguard.com/)
22. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
23. [ZeroTier docs](https://docs.zerotier.com/)
24. [OpenVPN](https://openvpn.net/)
25. 本机命令输出：`tailscale version`、`tailscale status`、`tailscale netcheck`、`tailscale ping -c 3 100.64.3.33`、`tailscale serve status`、`tailscale funnel status`（2026-11-03 10:41 CST）。

### 待核实/需实测

- 本机 DERP 健康检查的 “certificate is self-signed / likely intercepted connection” 是否由 `127.0.0.1:7890` 代理或运营商中间盒导致；需换网络/关代理复测。
- `tailscale serve` 已在本机配置并验证（8000 返回 200；DSH Web 8443 已关闭）；Funnel 仍未配置；ACL 仍需按管理员策略收紧。
- Funnel 的实际带宽上限、SSE/3D 场景可用性；官方只写“non-configurable bandwidth limits”，未给数值。
- 若考虑 Headscale，需逐项验证 Funnel/Serve、SSO、日志、Tailnet Lock 的支持情况。
