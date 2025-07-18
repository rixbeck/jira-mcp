#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import fs from 'fs';
import JiraClient from 'jira-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// Validate required environment variables
const requiredEnvVars = ['JIRA_HOST', 'JIRA_USERNAME', 'JIRA_ACCESS_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Create JIRA client instance
const jiraClient = new JiraClient({
  host: process.env.JIRA_HOST,
  username: process.env.JIRA_USERNAME,
  password: process.env.JIRA_PASSWORD,  // using password instead of token
  protocol: 'https',
  apiVersion: '2',
  strictSSL: true
});

// Define MCP tools
const GET_PROJECTS_TOOL = {
  name: "getProjects",
  description: "Get list of JIRA projects",
  inputSchema: {
    type: "object",
    properties: {
      archived: {
        type: "boolean",
        description: "Include archived projects"
      }
    }
  }
};

const GET_TASKS_TOOL = {
  name: "getTasks",
  description: "Get JIRA tasks based on JQL query",
  inputSchema: {
    type: "object",
    properties: {
      jql: {
        type: "string",
        description: "JQL query to filter tasks"
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Fields to include in the response"
      }
    },
    required: ["jql"]
  }
};

const GET_TASK_TOOL = {
  name: "getTask",
  description: "Get a single JIRA task by ID",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      }
    },
    required: ["taskId"]
  }
};

const UPDATE_TASK_STATUS_TOOL = {
  name: "updateTaskStatus",
  description: "Update the status of a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      statusId: {
        type: "string",
        description: "ID of the target status"
      }
    },
    required: ["taskId", "statusId"]
  }
};

const UPDATE_TASK_OWNER_TOOL = {
  name: "updateTaskOwner",
  description: "Update the assignee of a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      accountId: {
        type: "string",
        description: "Account ID of the user to assign the task to"
      }
    },
    required: ["taskId", "accountId"]
  }
};

const GET_TASK_ATTACHMENTS_TOOL = {
  name: "getTaskAttachments",
  description: "Get list of attachments for a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      }
    },
    required: ["taskId"]
  }
};

const DOWNLOAD_TASK_ATTACHMENT_TOOL = {
  name: "downloadTaskAttachment",
  description: "Download a specific attachment from a JIRA task by filename",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      filename: {
        type: "string",
        description: "Exact filename of the attachment to download"
      },
      outputPath: {
        type: "string",
        description: "Optional absolute path where the downloaded attachment should be written to. If empty, the content is returned.",
        nullable: true
      }
    },
    required: ["taskId", "filename"]
  }
};

const DOWNLOAD_TASK_ATTACHMENTS_TOOL = {
  name: "downloadTaskAttachments",
  description: "Download all attachments from a JIRA task to a specified directory",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      outputPath: {
        type: "string",
        description: "Directory path where all attachments should be downloaded"
      }
    },
    required: ["taskId", "outputPath"]
  }
};

const GET_AVAILABLE_STATUSES_TOOL = {
  name: "getAvailableStatuses",
  description: "Get list of available JIRA statuses for a task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      }
    },
    required: ["taskId"]
  }
};

const server = new Server(
  {
    name: "jira-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    GET_PROJECTS_TOOL,
    GET_TASKS_TOOL,
    GET_TASK_TOOL,
    UPDATE_TASK_STATUS_TOOL,
    UPDATE_TASK_OWNER_TOOL,
    GET_AVAILABLE_STATUSES_TOOL,
    GET_TASK_ATTACHMENTS_TOOL,
    DOWNLOAD_TASK_ATTACHMENT_TOOL,
    DOWNLOAD_TASK_ATTACHMENTS_TOOL
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "getProjects":
        const { archived = false } = request.params.arguments;
        const projects = await jiraClient.listProjects();
        const filteredProjects = archived ? 
          projects : 
          projects.filter(project => !project.archived);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(filteredProjects.map(project => ({
              id: project.id,
              key: project.key,
              name: project.name,
              archived: project.archived || false,
              projectTypeKey: project.projectTypeKey,
              simplified: project.simplified,
              style: project.style
            })), null, 2)
          }]
        };

      case "getTasks":
        const { jql, fields = ['summary', 'description', 'status', 'assignee', 'created', 'updated', 'duedate'] } = request.params.arguments;
        const tasks = await jiraClient.searchJira(jql, { fields });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(tasks.issues.map(issue => ({
              id: issue.id,
              key: issue.key,
              summary: issue.fields.summary,
              description: issue.fields.description,
              status: issue.fields.status,
              assignee: issue.fields.assignee,
              created: issue.fields.created,
              updated: issue.fields.updated,
              duedate: issue.fields.duedate,
              priority: issue.fields.priority
            })), null, 2)
          }]
        };

      case "getTask":
        const { taskId } = request.params.arguments;
        const issue = await jiraClient.findIssue(taskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: issue.id,
              key: issue.key,
              summary: issue.fields.summary,
              description: issue.fields.description,
              status: issue.fields.status,
              assignee: issue.fields.assignee,
              created: issue.fields.created,
              updated: issue.fields.updated,
              duedate: issue.fields.duedate,
              priority: issue.fields.priority
            }, null, 2)
          }]
        };

      case "updateTaskStatus":
        const task = request.params.arguments;
        const transitions = await jiraClient.listTransitions(task.taskId);
        const transition = transitions.transitions.find(t => t.to.id === task.statusId);
        
        if (!transition) {
          return {
            content: [{
              type: "text",
              text: `Invalid status transition for issue ${task.taskId} to status ${task.statusId}`
            }],
            isError: true
          };
        }

        await jiraClient.transitionIssue(task.taskId, { transition: { id: transition.id } });
        const updatedIssue = await jiraClient.findIssue(task.taskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: updatedIssue.id,
              key: updatedIssue.key,
              status: updatedIssue.fields.status
            }, null, 2)
          }]
        };

      case "updateTaskOwner":
        const { taskId: issueId, accountId } = request.params.arguments;
        await jiraClient.updateAssignee(issueId, accountId);
        const updatedTask = await jiraClient.findIssue(issueId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: updatedTask.id,
              key: updatedTask.key,
              assignee: updatedTask.fields.assignee
            }, null, 2)
          }]
        };

      case "getAvailableStatuses":
        const { taskId: statusTaskId } = request.params.arguments;
        const availableTransitions = await jiraClient.listTransitions(statusTaskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(availableTransitions.transitions.map(transition => ({
              id: transition.id,
              name: transition.name,
              to: {
                id: transition.to.id,
                name: transition.to.name,
                statusCategory: transition.to.statusCategory
              }
            })), null, 2)
          }]
        };

      case "getTaskAttachments":
        const { taskId: attachmentTaskId } = request.params.arguments;
        const taskWithAttachments = await jiraClient.findIssue(attachmentTaskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(taskWithAttachments.fields.attachment?.map(attachment => ({
              id: attachment.id,
              filename: attachment.filename,
              created: attachment.created,
              size: attachment.size,
              mimeType: attachment.mimeType,
              content: attachment.content,
              thumbnail: attachment.thumbnail
            })) || [], null, 2)
          }]
        };

      case "downloadTaskAttachment":
        const { taskId: downloadTaskId, filename, outputPath } = request.params.arguments;
        try {
          const issueWithAttachments = await jiraClient.findIssue(downloadTaskId);
          const attachment = issueWithAttachments.fields.attachment?.find(att => att.filename === filename);

          if (!attachment) {
            return {
              content: [{
                type: "text",
                text: `Attachment with filename '${filename}' not found for task ${downloadTaskId}`
              }],
              isError: true
            };
          }

          // The 'content' field in the attachment object contains the download URL
          const attachmentUrl = attachment.content;
          const response = await fetch(attachmentUrl, {
            headers: {
              'Authorization': `Basic ${Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD || process.env.JIRA_ACCESS_TOKEN}`).toString('base64')}`
            }
          });

          if (!response.ok) {
            throw new Error(`Failed to download attachment: ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          if (outputPath) {
            // Write to file if outputPath is provided
            await fs.promises.writeFile(outputPath, buffer);
            return {
              content: [{
                type: "text",
                text: `Attachment downloaded to ${outputPath}`
              }]
            };
          } else {
            // Return base64 content if outputPath is not provided
            const base64Content = buffer.toString('base64');
            return {
              content: [{
                type: "text",
                text: base64Content,
              }],
              metadata: {
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size
              }
            };
          }

        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error downloading attachment for task ${downloadTaskId}: ${error.message}`
            }],
            isError: true
          };
        }

      case "downloadTaskAttachments":
        const { taskId: downloadAllTaskId, outputPath: downloadDirectory } = request.params.arguments;
        try {
          // First, get all attachments for the task
          const issueWithAllAttachments = await jiraClient.findIssue(downloadAllTaskId);
          const attachments = issueWithAllAttachments.fields.attachment || [];

          if (attachments.length === 0) {
            return {
              content: [{
                type: "text",
                text: `No attachments found for task ${downloadAllTaskId}`
              }],
              isError: true
            };
          }

          // Ensure the output directory exists
          const absoluteOutputPath = resolve(downloadDirectory);
          await fs.promises.mkdir(absoluteOutputPath, { recursive: true });

          const downloadResults = [];
          const errors = [];

          // Download each attachment
          for (const attachment of attachments) {
            try {
              const attachmentUrl = attachment.content;
              const response = await fetch(attachmentUrl, {
                headers: {
                  'Authorization': `Basic ${Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD || process.env.JIRA_ACCESS_TOKEN}`).toString('base64')}`
                }
              });

              if (!response.ok) {
                throw new Error(`Failed to download attachment ${attachment.filename}: ${response.statusText}`);
              }

              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              const filePath = join(absoluteOutputPath, attachment.filename);

              await fs.promises.writeFile(filePath, buffer);
              downloadResults.push({
                filename: attachment.filename,
                path: filePath,
                size: attachment.size,
                mimeType: attachment.mimeType
              });
            } catch (error) {
              errors.push({
                filename: attachment.filename,
                error: error.message
              });
            }
          }

          // Prepare the response
          const successCount = downloadResults.length;
          const errorCount = errors.length;
          let responseText = `Downloaded ${successCount} of ${attachments.length} attachments for task ${downloadAllTaskId}\n\n`;
          
          if (downloadResults.length > 0) {
            responseText += "Successfully downloaded:\n";
            downloadResults.forEach(result => {
              responseText += `- ${result.filename} (${result.size} bytes) -> ${result.path}\n`;
            });
          }

          if (errors.length > 0) {
            responseText += "\nFailed downloads:\n";
            errors.forEach(error => {
              responseText += `- ${error.filename}: ${error.error}\n`;
            });
          }

          return {
            content: [{
              type: "text",
              text: responseText
            }],
            isError: errorCount > 0 && successCount === 0
          };

        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error downloading attachments for task ${downloadAllTaskId}: ${error.message}`
            }],
            isError: true
          };
        }

      default:
        return {
          content: [{
            type: "text",
            text: `Unknown tool: ${request.params.name}`
          }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: error.message
      }],
      isError: true
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("JIRA MCP server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
