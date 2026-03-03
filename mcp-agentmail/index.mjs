#!/usr/bin/env node

// AgentMail MCP Server - stdio transport for LM Studio
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AgentMailClient } from 'agentmail';

const API_KEY = process.env.AGENTMAIL_API_KEY || '';
const client = new AgentMailClient({ apiKey: API_KEY });

const server = new Server({
  name: 'agentmail',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

const tools = [
  {
    name: 'agentmail_list_inboxes',
    description: 'List all email inboxes',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'agentmail_get_messages',
    description: 'Get messages from an inbox',
    inputSchema: { 
      type: 'object', 
      properties: { 
        inbox_id: { type: 'string', description: 'Inbox ID (e.g., duckbot@agentmail.to)' }
      },
      required: ['inbox_id']
    }
  },
  {
    name: 'agentmail_send',
    description: 'Send an email via drafts',
    inputSchema: { 
      type: 'object', 
      properties: { 
        inbox_id: { type: 'string', description: 'Inbox ID to send from' },
        to: { type: 'string', description: 'Recipient email' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' }
      },
      required: ['inbox_id', 'to', 'subject', 'body']
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    let data;
    
    switch (name) {
      case 'agentmail_list_inboxes':
        data = await client.inboxes.list();
        break;
      case 'agentmail_get_messages':
        data = await client.inboxes.messages.list(args.address);
        break;
      case 'agentmail_send':
        data = await client.inboxes.drafts.send(args.to, args.draft_id || '', {
          to: args.to,
          subject: args.subject,
          body: args.body
        });
        break;
      default:
        return { content: [{ type: 'text', text: 'Unknown tool' }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('AgentMail MCP server running');
