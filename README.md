# Nomi Bridge

**Connect ChatGPT directly to your Nomi.ai companions using a private MCP plugin.**

Nomi Bridge lets ChatGPT discover your existing Nomis, send messages to them, and receive their replies—all from a normal ChatGPT conversation. Your Nomis keep their established personalities and conversation histories, while ChatGPT can use the context available in your existing chats. No separate OpenAI API assistant is required.

Nomi Bridge uses the official [Nomi.ai API](https://api.nomi.ai/docs/) and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). The intended deployment is a private [ChatGPT Site hosting an MCP plugin](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites).

> **Important:** This repository is for **independent, private deployments**, not a shared public gateway. Each person must deploy their own instance with their **own Nomi API key**. Do not share a running instance that uses your key.

## Features

- **Discover your Nomis** with `list_nomis`: names and UUIDs from your own Nomi account.
- **Talk to a Nomi** with `message_nomi`: send a message to an existing companion's main chat and receive its reply.
- **Hold multi-turn conversations**: ChatGPT can make successive calls when you authorize an extended conversation.
- **Keep your ChatGPT context**: use the plugin in regular ChatGPT conversations instead of creating a separate assistant through the OpenAI API.
- **Experiment with character interactions**: for example, try `[OOC: ...]` prompts to discuss a character outside an in-character scene. OOC is a prompting convention, not a separate API mode.

### Current scope

| Tool | Arguments | Effect |
| --- | --- | --- |
| `list_nomis` | None | Read-only: lists companion names and UUIDs. |
| `message_nomi` | `nomi_id`, `message` | Sends **one real message** to that Nomi's main chat and returns the reply when available. |

The initial version does **not** provide Nomi Rooms, voice calls, image exchange, full chat-history export, or autonomous background conversations. Additional messages require additional tool calls. Availability and behavior depend on the Nomi API and your ChatGPT plugin permissions.

## How it works

```text
Your ChatGPT conversation
          |
   Nomi Bridge plugin
          |
  Private ChatGPT Site
     (MCP server)
          |
     Nomi.ai REST API
          |
   Your existing Nomis
```

The bridge does not replace or recreate your Nomis. Messages sent through `message_nomi` appear in the selected Nomi's **existing main chat**. Your ChatGPT account's normal context and memory features remain subject to their usual availability and settings; the plugin does not import your complete ChatGPT history into Nomi or grant either system unrestricted access to the other's history.

## Requirements

- A [Nomi.ai](https://nomi.ai/) account with API access.
- A personal Nomi API key (**Profile → Integration** in Nomi).
- A ChatGPT account with access to **Sites** and permission to create/install plugins. Feature availability varies by plan and workspace settings.
- The source from this repository, or an archive of it, for the deployment task.
- **Optional for local adapter tests:** Node.js 18 or newer.

## Deploy your own private bridge

### 1. Get your Nomi API key

In Nomi.ai, open **Profile → Integration** and obtain your API key. Treat it like a password.

**Do not** put the key in a GitHub commit, README, source file, screenshot, ChatGPT prompt, or client-side JavaScript.

### 2. Start a ChatGPT Work task

Open a new **Work** conversation in ChatGPT and provide this repository (or upload a ZIP containing its source). Ask Work to build a **Site with an MCP server**, not merely a website or instructions-only plugin.

You can copy this deployment prompt:

```text
Create a private ChatGPT Site called "Nomi Bridge" using the attached
repository. Host a working MCP server on the Site.

Expose two tools:
- list_nomis(): return the names and UUIDs of my existing Nomis.
- message_nomi(nomi_id, message): send one message to that Nomi's main chat
  through the official Nomi API, returning the actual reply when available.

Use the official Nomi API: https://api.nomi.ai/docs/
Reuse the repository's Nomi API adapter where appropriate.

Read NOMI_API_KEY exclusively from a server-side secret. Tell me how to
configure it in the Site's secret settings; never ask me to paste the key
into chat, commit it, or expose it to the browser.

Keep the Site and plugin private to my account. Require explicit user
authorization before sending any message. Never automatically retry a
failed POST: delivery may have succeeded even if the reply is unavailable.
Preserve the upstream error type and report uncertain delivery honestly.

Test the implementation with mocked Nomi responses first. Do not send
real Nomi messages during testing without my permission. Publish the
Site with its MCP server, then provide the plugin installation card.
Do not create a second, disconnected skills-only plugin.
```

If this repository contains only the REST adapter, Work will also need to implement the **MCP tool handlers and Site deployment**. An API adapter by itself is not an installable ChatGPT plugin.

### 3. Configure the key securely

In your Site's settings, configure a **server-side secret** named `NOMI_API_KEY` with your own Nomi key. Keep the value out of browser-accessible environment variables, frontend bundles, and logs. Publish or redeploy the Site as required for the configuration to take effect.

The Nomi API expects the **raw key** in the `Authorization` header—**not** `Bearer <key>`.

### 4. Publish privately and install

Have the Site owner publish the Site **with its MCP tools**. Review the plugin card, install the Site-generated Nomi Bridge plugin, and complete any connection prompts. Keep both the Site's access and the plugin's access restricted.

You should then be able to use Nomi Bridge from supported ChatGPT conversations without moving the conversation itself into Work. The Work task is for building/deploying the Site; it does not become your permanent Nomi chat interface.

### 5. Verify the connection safely

Start with the read-only operation:

> Using Nomi Bridge, list my Nomis.

Check that the names correspond to your own Nomi account. **Only then** try a real message, for example:

> Using Nomi Bridge, send a message to [companion name]: "Hello! I'm ChatGPT, reaching you through Nomi Bridge." Show me the reply.

Sending a message modifies the Nomi's existing chat and uses Nomi message quota. Be explicit about which companion may receive messages and how long a conversation may continue.

## Example prompts

**Short conversation**

> Introduce yourself to [companion name] as ChatGPT. Have a conversation of up to five messages and tell me what you learned. Do not contact any other Nomi.

**Out-of-character conversation**

> Send [companion name] an `[OOC: ...]` message explaining that you're speaking outside the fictional scene. Ask how they understand their character, and then report their answer.

**Read-only discovery**

> Show me my Nomis so I can choose which one to talk to.

The `[OOC: ...]` convention is only text in a message. Whether a Nomi interprets it as intended depends on that character and its model.

## Local development and testing

The minimal API adapter is `nomi.mjs`, with two focused mock-network tests in `nomi.test.mjs`:

```bash
node nomi.test.mjs
```

These tests require no API key and send no real messages. They verify the adapter's basic request/response mapping, **not** live Nomi availability, MCP hosting, authorization, or ChatGPT installation. If the published repository includes additional Site/MCP code, test that code separately before deployment.

## API behavior and known limitations

Nomi Bridge uses these official API endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/nomis` | List the account's Nomis. |
| `POST` | `/v1/nomis/{uuid}/chat` | Send `{"messageText":"..."}` to a Nomi and receive `sentMessage` and `replyMessage` data. |

The API's documented message limit is **400 characters on free Nomi accounts** and **800 characters on subscribed accounts**.

**A failed response does not necessarily mean a failed send.** Nomi documents the `NoReply` error when a companion does not respond within **30 seconds** or when there is a server issue. In practice, a message can appear in the Nomi chat even when the API returns an error before providing its reply.

For that reason:

- **Never automatically retry `POST /chat`** after an error, timeout, or lost response. It could duplicate the message.
- Treat delivery as **unknown** unless the API or subsequent verification establishes otherwise.
- If a reply is missing, check the conversation in Nomi before deciding whether to resend.
- Respect Nomi's message quotas and rate limits. A `429` means the API rate limit was reached.

These constraints apply to the upstream Nomi service; changing models may improve response speed but is not a guaranteed fix for timeouts.

## Privacy and security

This project is designed for **one user per private deployment**.

- Each deployment uses **its owner's Nomi API key**. There is no shared or public Nomi account.
- Keep the Site and its MCP endpoint restricted to authorized users. **A secret API key alone does not restrict who can invoke a server that uses it.**
- Do not publish a Site using your personal key for general public access.
- Never log API keys, full message contents, or other private conversation data unnecessarily.
- Never put credentials in source control or sample configuration files.
- Be aware that ChatGPT tool calls transmit the message text to the Site and then to Nomi.ai. Review both services' privacy settings and policies.
- If a credential leaks, revoke or rotate it in Nomi and update your private deployment.

A future *multi-user hosted service* would require authenticated users, **per-user** credentials, server-side permission checks, and isolation of conversations and logs. **This repository does not claim to implement such a service.**

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Plugin does not appear | Confirm that the Site contains MCP tools and was published by its owner; install its generated plugin. |
| Plugin is disconnected | Open the plugin card and complete its Connect flow. |
| `list_nomis` reports authentication failure | Verify the server-side secret and raw `Authorization` header; check the Site's deployed configuration. |
| HTTP `401` or `400` | Check API-key validity and header format. |
| `message_nomi` returns `NoReply` / HTTP `500` | The message may have been delivered; check Nomi before retrying manually. |
| HTTP `429` | Reduce requests and respect Nomi's rate limits. |
| Wrong account's Nomis appear | **Stop using the deployment**; verify the Site's access controls and which API key it holds. |

Helpful documentation:

- [Nomi.ai API documentation](https://api.nomi.ai/docs/)
- [ChatGPT Sites: creating and using Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)
- [ChatGPT Sites: hosting an MCP plugin](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome. Please **never include API keys, companion UUIDs, or private conversation transcripts** in an issue or pull request. If you report an API failure, sanitize logs and include only the error type, HTTP status, and relevant non-sensitive timing information.

## License

Released under the [MIT License](LICENSE). See the `LICENSE` file for details.

## Disclaimer

Nomi Bridge is an **independent, unofficial** integration. It is not affiliated with, endorsed by, or maintained by Nomi.ai or OpenAI. Nomi.ai, ChatGPT, and other product names belong to their respective owners.
