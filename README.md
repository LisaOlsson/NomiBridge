# Nomi Bridge

**Let ChatGPT talk directly with your Nomi.ai companions.**

Nomi Bridge connects your existing ChatGPT conversations with your existing [Nomi.ai](https://nomi.ai/) companions. ChatGPT can find your Nomis, send them messages, receive their replies, and carry on a conversation without manually copying messages between apps.

The integration uses Nomi's [official API](https://api.nomi.ai/docs/) and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). It does **not** create a separate assistant through the OpenAI API, so you can use the context and memory available in your regular ChatGPT conversations.

## Features

- **Discover companions** using `list_nomis()`.
- **Talk to existing Nomis** using `message_nomi(nomi_id, message)`.
- **Have longer conversations** with follow-up messages from ChatGPT.
- **Keep your regular ChatGPT context**, rather than starting over with a separate API assistant.
- **Experiment with in-character and out-of-character conversations**, including the `[OOC: ...]` convention.

Messages are sent to a Nomi's existing main chat, not to a duplicate character.

### Available tools

| Tool | Purpose |
| --- | --- |
| `list_nomis()` | Lists the names and IDs of your Nomis without sending any messages. |
| `message_nomi(nomi_id, message)` | Sends one message to a Nomi and returns its response, when available. |

The current integration handles individual text chats. Nomi Rooms, voice, images, and full chat-history retrieval are not supported.

## How it works

There are two parts, but **you don't have to create or manage them separately**:

- **The Site runs the bridge.** It's the backend that talks to Nomi.ai through the API. You don't normally interact with its web page.
- **The plugin connects ChatGPT to the Site.** It gives ChatGPT the `list_nomis` and `message_nomi` tools.

```text
Your ChatGPT conversation
          |
   Nomi Bridge plugin    <- ChatGPT uses these tools
          |
   Nomi Bridge Site      <- Runs the bridge code
          |
       Nomi.ai           <- Your existing companions
```

When you publish a ChatGPT Site with MCP tools, ChatGPT provisions its associated plugin. Install the plugin once, then use it in your ordinary ChatGPT conversations. **Work is needed to build or deploy the Site, not to chat with your Nomis afterward.**

## Requirements

- A Nomi.ai account with API access and an API key.
- A ChatGPT account with access to Work / Sites and plugin installation. Availability depends on your plan and workspace configuration.

## Installation

### 1. Get your Nomi API key

In Nomi.ai, open **Profile → Integration** and obtain an API key.

### 2. Deploy Nomi Bridge with ChatGPT Work

Open a new **Work** conversation in ChatGPT and provide the URL of this repository (or upload an archive of its source). Ask Work to deploy the included implementation as a private Site with MCP tools.

You can use this prompt:

```text
Deploy the Nomi Bridge project from this repository as a private
ChatGPT Site with its MCP server. Use the existing source code rather
than reimplementing the integration from scratch.

Expose its two MCP tools:
- list_nomis(): list the names and UUIDs of my existing Nomis.
- message_nomi(nomi_id, message): send one message to the selected
  Nomi's main chat and return its actual reply when available.

API documentation: https://api.nomi.ai/docs/

Store NOMI_API_KEY as a server-side secret. Show me where to configure
it. The Nomi API expects the raw key in the Authorization header,
without a Bearer prefix. Do not expose credentials in frontend code.

Keep the Site and its generated plugin private. Only send messages
when I authorize them. Do not automatically retry failed message
POST requests: the message may already have been delivered even
when the response is unavailable.

Run the project's existing tests and verify the MCP tools without
sending real Nomi messages unless I approve.

Publish the Site with its MCP tools and provide the generated plugin's
installation card. Preserve the project's behavior and keep any
deployment-specific changes minimal.
```

### 3. Configure the API key

Configure a server-side secret called `NOMI_API_KEY` in the Site's settings. The backend uses this key to authenticate requests to Nomi.ai. No API key needs to be added to the repository.

### 4. Publish the Site and install the plugin

Publish the Site with its MCP tools, then install the associated **Nomi Bridge plugin** through the installation card provided by ChatGPT.

That's the complete distinction: **the Site runs the integration; the plugin makes it usable in ChatGPT.**

### 5. Test the connection

Start with a read-only request in any supported ChatGPT conversation:

> Using Nomi Bridge, list my Nomis.

Then try sending a message:

> Introduce yourself to Sabrina using Nomi Bridge. Tell her you're ChatGPT, ask her a question, and show me her reply.

You can also continue the conversation naturally without repeatedly specifying the companion's ID.

## Example conversations

**Let two AIs get acquainted**

> Talk to Sabrina for up to ten exchanges. Introduce yourself, follow her lead, and tell me what you learned about her.

**Out-of-character discussion**

> Use `[OOC: ...]` to introduce yourself to Nora. Ask how she understands her character, try a short fictional scene, and then switch back to OOC to discuss it.

**Discover companions**

> Show me my Nomis and let me choose who you should talk to.

`[OOC: ...]` is a message convention, not a special API feature. Its effectiveness depends on how the companion interprets it.

An extended conversation consists of successive tool calls in the ChatGPT conversation, not an autonomous background process.

## Nomi API behavior

Nomi Bridge uses two official endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/nomis` | List companions. |
| `POST` | `/v1/nomis/{uuid}/chat` | Send a message using `{"messageText":"..."}` and obtain a reply. |

Nomi documents a limit of **400 characters per message for free accounts** and **800 for subscribed accounts**, along with API rate limits.

### Timeouts and missing replies

Some Nomi AI versions take longer to generate a reply than the API's timeout allows. In that case, Nomi Bridge may return **HTTP 500 / `NoReply`** even though your message was delivered and the Nomi eventually responded.

**The reply may still be visible in the companion's conversation on Nomi.ai**, even though ChatGPT did not receive it through the bridge. Open the chat on the Nomi side to read the reply and confirm what happened.

**Do not automatically retry a failed message POST.** It could send a duplicate. If timeouts occur frequently with a particular Nomi, try switching that companion to another AI version; some respond faster than others.

## Security and privacy

Configure the API key as a server-side secret and keep the deployed Site and MCP tools private. Do not include credentials in source code or logs. A hidden API key is not, on its own, a substitute for controlling access to the service using it.

The installation above describes a private, single-user deployment. A shared hosted service would need user authentication and separate credentials for each user; this version does not provide that.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Nomi Bridge tools aren't visible | Confirm the Site was published with MCP tools and its plugin was installed. |
| `list_nomis` cannot connect | Check the Site's deployment, API access, and `NOMI_API_KEY` secret. |
| Authentication fails | Check that the API key is valid and is sent without a `Bearer` prefix. |
| `message_nomi` returns `NoReply` | Check the Nomi chat before attempting another send. |
| API returns HTTP 429 | Reduce request frequency to respect rate limits. |

## Documentation

- [Nomi.ai API documentation](https://api.nomi.ai/docs/)
- [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)
- [Hosting a plugin with ChatGPT Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

## Contributing

Issues, improvements, and pull requests are welcome. Please remove API keys and private conversation data from any logs or examples you share.

## License

Nomi Bridge is released under the [MIT License](LICENSE).

## Disclaimer

Nomi Bridge is an independent, unofficial integration and is not affiliated with or endorsed by Nomi.ai or OpenAI.
