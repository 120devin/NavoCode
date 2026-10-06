# Owning-host messaging transport

This adapter connects NavoCode to an existing owner's messaging gateway. It does not implement four native CLI gateways, acquire a chat writer, create a chat, or bypass desktop client authorization. The CLI-resume transport remains separate.

Configure an executable argv array with `--agent-host-command` or `NAVOCODE_HOST_MCP_COMMAND`, choose `--agent codex|claude|cursor|copilot|custom`, and bind `--agent-session` to the exact original chat. The command implements MCP over newline-delimited JSON on stdio. Credentials and host connection details belong in trusted local configuration, never browser inputs. The gateway must connect to the existing session owner, not launch a competing assistant process.

NavoCode initializes the MCP connection and requires these tools:

| Tool | Arguments | Successful data |
| --- | --- | --- |
| `read_thread` | `threadId`, `turnLimit`, `includeOutputs`, `maxOutputCharsPerItem` | `{thread: {id, status}, turns: [...]}` |
| `send_message_to_thread` | `threadId`, `prompt` | `{threadId}` confirming the exact requested chat |

Data may be in MCP `structuredContent` or one JSON text content block. Failures use the MCP error envelope or `isError: true`; the client does not switch to another transport or choose a different chat. Tool-call metadata includes the actual bound caller chat in `openai/threadId`.

`read_thread` must return recent turns including their opening input. A turn has `id`, `status` (`inProgress`, `completed`, `failed`, or `interrupted`), optional `error.message`, and `items`. Opening inputs are `userMessage` or `steeringUserMessage` with `content: [{type: "text", text}]`, or `functionCallOutput` with string `output`. Assistant items have `type: "agentMessage"`, `text`, and preferably `phase: "final_answer"`. Unrelated turns and commentary are never accepted as the workspace reply. The gateway must preserve the unique message marker in the original chat's input. A status without a final reply is not success.

The adapter waits while the owning chat reports an active turn, then sends the message through that owner. It keeps the host's authentication, model, and permissions. Host permission requests are not automatically approved by this MCP client.

Before sending, NavoCode atomically stores a private delivery record under `.navocode/local/host-deliveries`. Once submission starts, a lost connection or timeout does not permit another submission. Retry reconnects and finds the same message marker. If delivery cannot be confirmed, it times out rather than risking duplicate edits. An explicitly failed/interrupted host turn may be retried as a new attempt. Completed results are idempotent. Stopping NavoCode terminates its gateway client; an already-submitted host turn may continue in the owning assistant.

## Verification and remaining integration work

Deterministic MCP process tests cover original context, exact chat IDs, final-reply correlation, permission rejection, detached workspace delivery, and reconnect recovery without duplicate submissions. Selecting a provider in those tests verifies common transport routing, not that provider's native API.

The local Codex desktop MCP client probe was rejected by desktop authorization. NavoCode does not alter that authorization or claim a successful live desktop turn. Published Cursor ACP and Claude streaming-input interfaces describe client-managed connections; these do not establish attachment to every already-open interactive process. Copilot documents SDK connections to an existing configured runtime. Native authenticated gateways for all four remain required for this workflow.

References: [Codex app server](https://learn.chatgpt.com/docs/app-server), [Cursor ACP](https://prod.cursor.com/docs/cli/acp), [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [Claude Remote Control](https://code.claude.com/docs/en/remote-control), and [Copilot existing runtime connection](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services).
