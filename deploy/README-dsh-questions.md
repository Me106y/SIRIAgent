# DSH 问答通道补丁

`ask_user_question` 在 DSH 的 Web 宿主里是完整的；SDK 路径缺一个 answerer。
`dsh-sdk-questions.patch` 给 `@deepseek-ai/dsh-sdk-jsonrpc-server` 增加：

- 监听 `user-questions/request` 瀑布；
- 通过 `transport.request('userQuestion/ask', {questions, callId})` 把问题发给 Python 客户端；
- 客户端答复后返回 `{answers:[{id, selected, custom?}]}`。

## 应用

```bash
cd /path/to/deepseek-harness
git apply /path/to/SIRIAgent/deploy/dsh-sdk-questions.patch
pnpm run build:lib:host        # 或只重建 sdk/server 包
```

本机当前是在 `packages/sdk/server/lib/index.js`（构建产物，gitignored）里直接打了同样逻辑，
所以演示台无需重建即可用；升级 DSH 或重建 runtime 后需要重新应用本补丁。

## 验证

```bash
curl -sN -X POST http://127.0.0.1:8000/api/chat/stream -H 'Content-Type: application/json' \
  -d '{"message":"请调用 ask_user_question 问我：覆盖哪个城市？只给杭州和北京。"}'
# SSE 应出现 question 事件；POST /api/question/answer 后继续 tool_result 与最终回答
```
