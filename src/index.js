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
if (!process.env.JIRA_HOST) {
  throw new Error('Missing required environment variable: JIRA_HOST');
}

let jiraClientOptions = {
  host: process.env.JIRA_HOST,
  protocol: 'https',
  apiVersion: '2',
  strictSSL: true,
};

if (process.env.JIRA_ACCESS_TOKEN) {
  jiraClientOptions.bearer = process.env.JIRA_ACCESS_TOKEN;
} else {
  const missingCreds = [];
  if (!process.env.JIRA_USERNAME) missingCreds.push('JIRA_USERNAME');
  if (!process.env.JIRA_PASSWORD) missingCreds.push('JIRA_PASSWORD');
  if (missingCreds.length) {
    throw new Error(`Missing required environment variables: ${missingCreds.join(', ')} or JIRA_ACCESS_TOKEN`);
  }
  jiraClientOptions.username = process.env.JIRA_USERNAME;
  jiraClientOptions.password = process.env.JIRA_PASSWORD;
}

// Create JIRA client instance
const jiraClient = new JiraClient(jiraClientOptions);

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

const UPDATE_TASK_TOOL = {
  name: "updateTask",
  description: "Update fields of a JIRA task, optionally including its status. Only the given fields change.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      summary: {
        type: "string",
        description: "New summary (title)"
      },
      description: {
        type: "string",
        description: "New description, replacing the previous one"
      },
      assignee: {
        type: "string",
        description: "JIRA username to assign the task to; empty string unassigns"
      },
      priority: {
        type: "string",
        description: "Priority name as configured in JIRA (e.g., Major)"
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Labels, replacing the current label set"
      },
      duedate: {
        type: "string",
        description: "Due date in YYYY-MM-DD format"
      },
      status: {
        type: "string",
        description: "Target status or transition, by name or id (e.g., \"Nyitott\", \"Fejlesztésre kiválasztva\", \"1\"). Runs a workflow transition, so only statuses reachable from the current one are valid — getAvailableStatuses lists them."
      },
      // Same escape hatch as createTask: project-specific custom fields go here
      // instead of growing this schema.
      extraFields: {
        type: "object",
        description: "Additional JIRA fields merged verbatim into the update (e.g., {\"customfield_10001\": \"value\"})"
      }
    },
    required: ["taskId"]
  }
};

const UPDATE_TASK_STATUS_TOOL = {
  name: "updateTaskStatus",
  description: "Update the status of a JIRA task (see also updateTask, which can change status together with other fields)",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      statusId: {
        type: "string",
        description: "Target status or transition, by name or id (e.g., \"Nyitott\", \"Fejlesztésre kiválasztva\", \"1\")"
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
        description: "JIRA username of the assignee — on Server/DC this is the login name (e.g., siftark), not a Cloud accountId"
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

const CREATE_TASK_TOOL = {
  name: "createTask",
  description: "Create a new JIRA task (issue)",
  inputSchema: {
    type: "object",
    properties: {
      projectKey: {
        type: "string",
        description: "Key of the project to create the task in (e.g., RHOR)"
      },
      issueType: {
        type: "string",
        description: "Issue type name as configured in the project (e.g., Story, Bug, Internal task, Feature Request). Defaults to Story. There is no plain \"Task\" type on this JIRA."
      },
      summary: {
        type: "string",
        description: "Task summary (title)"
      },
      description: {
        type: "string",
        description: "Task description"
      },
      assignee: {
        type: "string",
        description: "JIRA username to assign the task to (Server/DC name, not accountId)"
      },
      priority: {
        type: "string",
        description: "Priority name as configured in JIRA (e.g., Major)"
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Labels to attach to the task"
      },
      parentKey: {
        type: "string",
        description: "Key of the parent issue, for sub-task types (e.g., PROJECT-123)"
      },
      // Escape hatch for project-specific required fields: extend this instead of the
      // schema above when a JIRA project mandates custom fields (customfield_XXXXX).
      extraFields: {
        type: "object",
        description: "Additional JIRA fields merged verbatim into the create request (e.g., {\"customfield_10001\": \"value\"})"
      }
    },
    required: ["projectKey", "summary"]
  }
};

const ADD_TASK_COMMENT_TOOL = {
  name: "addTaskComment",
  description: "Add a comment to a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      body: {
        type: "string",
        description: "Comment text"
      }
    },
    required: ["taskId", "body"]
  }
};

const GET_COMMENTS_TOOL = {
  name: "getTaskComments",
  description: "Get all comments for a JIRA task",
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

const GET_PROJECT_USERS_TOOL = {
  name: "getProjectUsers",
  description: "Get list of available users under a specific JIRA project",
  inputSchema: {
    type: "object",
    properties: {
      projectKey: {
        type: "string",
        description: "JIRA project key (e.g., PROJECTKEY)"
      },
      maxResults: {
        type: "integer",
        description: "Maximum number of results to return (default: 50)",
        default: 50
      },
      startAt: {
        type: "integer",
        description: "Starting index of results (default: 0)",
        default: 0
      }
    },
    required: ["projectKey"]
  }
};

const ADD_ATTACHMENT_TOOL = {
  name: "addAttachment",
  description: "Add an attachment to a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      filePath: {
        type: "string",
        description: "Path to the file to attach"
      },
      filename: {
        type: "string",
        description: "Optional filename to use for the attachment. If not provided, the original filename will be used.",
        nullable: true
      },
      comment: {
        type: "string",
        description: "Optional comment to add with the attachment",
        nullable: true
      }
    },
    required: ["taskId", "filePath"]
  }
};

const server = new Server(
  {
    name: "jira-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

function toCommentBody(body) {
  if (typeof body === 'string') {
    return body;
  }

  // Jira Server/DC typically returns string bodies, but handle ADF-like payloads defensively.
  if (body && Array.isArray(body.content)) {
    const textParts = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.text === 'string') textParts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    body.content.forEach(walk);
    return textParts.join('');
  }

  return '';
}

function mapComments(commentField) {
  if (!commentField || !Array.isArray(commentField.comments)) {
    return [];
  }

  return commentField.comments.map((comment) => ({
    id: comment.id,
    body: toCommentBody(comment.body),
    author: comment.author?.displayName,
    created: comment.created,
    updated: comment.updated,
    mentions: []
  }));
}

// A status change is a workflow transition, not a field write, so callers cannot just
// PUT a status. Accept whatever they happen to know — target status name/id or
// transition name/id — and resolve it here. Shared by updateTask and updateTaskStatus
// so the two can never drift apart.
async function resolveTransitionId(taskId, status) {
  const { transitions } = await jiraClient.listTransitions(taskId);
  const wanted = String(status).trim().toLowerCase();
  const match = transitions.find(transition =>
    transition.to.id === String(status) ||
    transition.id === String(status) ||
    transition.to.name.toLowerCase() === wanted ||
    transition.name.toLowerCase() === wanted
  );

  if (!match) {
    const available = transitions
      .map(transition => `"${transition.name}" -> "${transition.to.name}" (status id ${transition.to.id})`)
      .join('; ');
    throw new Error(
      `No transition matching "${status}" is available from the current status of ${taskId}. ` +
      `Available: ${available || 'none'}`
    );
  }

  return match.id;
}

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    GET_PROJECTS_TOOL,
    GET_TASKS_TOOL,
    GET_TASK_TOOL,
    CREATE_TASK_TOOL,
    ADD_TASK_COMMENT_TOOL,
    UPDATE_TASK_TOOL,
    UPDATE_TASK_STATUS_TOOL,
    UPDATE_TASK_OWNER_TOOL,
    GET_AVAILABLE_STATUSES_TOOL,
    GET_TASK_ATTACHMENTS_TOOL,
    DOWNLOAD_TASK_ATTACHMENT_TOOL,
    DOWNLOAD_TASK_ATTACHMENTS_TOOL,
    GET_COMMENTS_TOOL,
    GET_PROJECT_USERS_TOOL,
    ADD_ATTACHMENT_TOOL
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
        const { jql, fields = ['summary', 'description', 'status', 'assignee', 'created', 'updated', 'duedate', 'comment'] } = request.params.arguments;
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
              priority: issue.fields.priority,
              comments: mapComments(issue.fields.comment)
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
              priority: issue.fields.priority,
              comments: mapComments(issue.fields.comment)
            }, null, 2)
          }]
        };

      case "createTask":
        const {
          projectKey,
          issueType = 'Story',
          summary,
          description,
          assignee,
          priority,
          labels,
          parentKey,
          extraFields
        } = request.params.arguments;

        const issueFields = {
          project: { key: projectKey },
          issuetype: { name: issueType },
          summary
        };

        if (description) issueFields.description = description;
        // Jira Server/DC identifies users by name; Cloud's accountId is not accepted here.
        if (assignee) issueFields.assignee = { name: assignee };
        if (priority) issueFields.priority = { name: priority };
        if (labels && labels.length) issueFields.labels = labels;
        if (parentKey) issueFields.parent = { key: parentKey };
        if (extraFields) Object.assign(issueFields, extraFields);

        let createdIssue;
        try {
          createdIssue = await jiraClient.addNewIssue({ fields: issueFields });
        } catch (createError) {
          // Issue type names are per-project configuration, so a rejected type is a
          // discovery problem, not a bug: answer it with the project's actual types.
          if (/issuetype/i.test(createError.message)) {
            const targetProject = await jiraClient.getProject(projectKey);
            const availableTypes = (targetProject.issueTypes || [])
              .filter(type => !type.subtask)
              .map(type => type.name)
              .join(', ');
            throw new Error(`${createError.message} Available issue types in ${projectKey}: ${availableTypes}`);
          }
          throw createError;
        }

        const createdTask = await jiraClient.findIssue(createdIssue.key);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: createdTask.id,
              key: createdTask.key,
              summary: createdTask.fields.summary,
              status: createdTask.fields.status,
              assignee: createdTask.fields.assignee,
              url: `https://${process.env.JIRA_HOST}/browse/${createdTask.key}`
            }, null, 2)
          }]
        };

      case "addTaskComment":
        const { taskId: commentTaskId, body: commentBody } = request.params.arguments;
        const newComment = await jiraClient.addComment(commentTaskId, commentBody);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: newComment.id,
              body: toCommentBody(newComment.body),
              author: newComment.author?.displayName,
              created: newComment.created
            }, null, 2)
          }]
        };

      case "updateTask":
        const {
          taskId: updateTaskId,
          summary: newSummary,
          description: newDescription,
          assignee: newAssignee,
          priority: newPriority,
          labels: newLabels,
          duedate: newDuedate,
          status: newStatus,
          extraFields: updateExtraFields
        } = request.params.arguments;

        const updateFields = {};
        if (newSummary !== undefined) updateFields.summary = newSummary;
        if (newDescription !== undefined) updateFields.description = newDescription;
        // An empty assignee means "unassign", which the API expresses as a null field.
        if (newAssignee !== undefined) updateFields.assignee = newAssignee ? { name: newAssignee } : null;
        if (newPriority !== undefined) updateFields.priority = { name: newPriority };
        if (newLabels !== undefined) updateFields.labels = newLabels;
        if (newDuedate !== undefined) updateFields.duedate = newDuedate;
        if (updateExtraFields) Object.assign(updateFields, updateExtraFields);

        const changedParts = [];
        if (Object.keys(updateFields).length) {
          await jiraClient.updateIssue(updateTaskId, { fields: updateFields });
          changedParts.push(...Object.keys(updateFields));
        }

        // Transition last: a failed field write should not leave the task already moved.
        if (newStatus !== undefined && newStatus !== null && newStatus !== '') {
          const transitionId = await resolveTransitionId(updateTaskId, newStatus);
          await jiraClient.transitionIssue(updateTaskId, { transition: { id: transitionId } });
          changedParts.push('status');
        }

        if (!changedParts.length) {
          return {
            content: [{
              type: "text",
              text: `Nothing to update on ${updateTaskId}: no updatable field was given.`
            }],
            isError: true
          };
        }

        const updatedFull = await jiraClient.findIssue(updateTaskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              key: updatedFull.key,
              updated: changedParts,
              summary: updatedFull.fields.summary,
              status: updatedFull.fields.status,
              assignee: updatedFull.fields.assignee,
              priority: updatedFull.fields.priority,
              labels: updatedFull.fields.labels,
              duedate: updatedFull.fields.duedate,
              url: `https://${process.env.JIRA_HOST}/browse/${updatedFull.key}`
            }, null, 2)
          }]
        };

      case "updateTaskStatus":
        const task = request.params.arguments;
        const statusTransitionId = await resolveTransitionId(task.taskId, task.statusId);
        await jiraClient.transitionIssue(task.taskId, { transition: { id: statusTransitionId } });
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

      case "getTaskComments":
        const { taskId: commentsTaskId } = request.params.arguments;
        try {
          // Get the issue details which includes comments
          const issue = await jiraClient.findIssue(commentsTaskId, { fields: ['comment'] });
          
          // Extract and format comments
          const comments = issue.fields.comment?.comments || [];
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify(comments.map(comment => ({
                id: comment.id,
                author: {
                  id: comment.author.id,
                  name: comment.author.displayName,
                  emailAddress: comment.author.emailAddress
                },
                body: comment.body,
                created: comment.created,
                updated: comment.updated,
                jsdPublic: comment.jsdPublic
              })), null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting comments for task ${commentsTaskId}: ${error.message}`
            }],
            isError: true
          };
        }

      case "getProjectUsers":
        const { projectKey: userProjectKey, maxResults = 50, startAt = 0 } = request.params.arguments;
        try {
          // Get users assignable to the project using JIRA's user search
          // We'll use the user search with project context to find assignable users
          const users = await jiraClient.getUsersAssignableToProject({
            projectKey: userProjectKey,
            maxResults,
            startAt
          });
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify(users.map(user => ({
                accountId: user.accountId,
                displayName: user.displayName,
                emailAddress: user.emailAddress,
                active: user.active,
                timeZone: user.timeZone,
                avatarUrls: user.avatarUrls
              })), null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting users for project ${userProjectKey}: ${error.message}`
            }],
            isError: true
          };
        }

      case "addAttachment":
        const { taskId: addAttachmentTaskId, filePath, filename: attachmentFilename, comment: attachmentComment } = request.params.arguments;
        try {
          // Check if the file exists
          if (!fs.existsSync(filePath)) {
            return {
              content: [{
                type: "text",
                text: `File not found: ${filePath}`
              }],
              isError: true
            };
          }

          // Read the file
          const fileBuffer = fs.readFileSync(filePath);
          
          // Get the original filename from the path if not provided
          const path = require('path');
          const originalFilename = attachmentFilename || path.basename(filePath);
          
          // Add the attachment to the issue
          const attachment = await jiraClient.addAttachment(addAttachmentTaskId, fileBuffer, originalFilename, attachmentComment);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                id: attachment.id,
                filename: attachment.filename,
                taskId: addAttachmentTaskId,
                created: attachment.created,
                size: attachment.size,
                mimeType: attachment.mimeType,
                comment: attachmentComment
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error adding attachment to task ${addAttachmentTaskId}: ${error.message}`
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
