# JIRA MCP Server

A Model Context Protocol (MCP) server that addresses integration with self-hosted JIRA, enabling AI assistants to interact with JIRA issues and projects through a standardized interface.

## Features

- Get list of JIRA projects
- Query JIRA tasks using JQL
- Get task details
- Create a new task
- Add a comment to a task
- Update task fields (summary, description, assignee, priority, labels, due date, custom fields), optionally together with the status
- Update task status (by status or transition name, or by id)
- Update task assignee
- Get available task statuses
- Get task attachments
- Download task attachments by filename

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```
3. Configure environment variables by copying `.env.example` to `.env`:
```bash
cp .env.example .env
```
4. Update the `.env` file with your JIRA credentials:
```
JIRA_HOST=your.jira.host
JIRA_USERNAME=yourname
JIRA_PASSWORD=yourpassword
# Or use access token authentication:
# JIRA_ACCESS_TOKEN=yourtoken
```

## Usage

Start the MCP server:

```bash
npm start
```

The server will start and register itself with any MCP-compatible AI assistants.

### Available Tools

#### downloadTaskAttachment

Download a specific attachment from a JIRA task by filename.

**Parameters:**
- `taskId` (string, required): JIRA task ID (e.g., PROJECT-123)
- `filename` (string, required): Exact filename of the attachment to download

**Response:**
Returns base64 encoded binary data with metadata including:
- `filename`: The name of the downloaded file
- `mimeType`: The MIME type of the file
- `size`: The file size in bytes
- `content`: Base64 encoded file content

**Example Usage:**
```json
{
  "taskId": "PROJECT-123",
  "filename": "document.pdf"
}
```

This function is useful for retrieving specific attachments from JIRA tasks when you know the exact filename, allowing you to download and process files programmatically.

## Dependencies

- @modelcontextprotocol/sdk
- jira-client
- dotenv
- zod

## Author

- **Name**: Rix Beck
- **GitHub**: [rixbeck](https://github.com/rixbeck)

## License

This project is licensed under the MIT License.

Copyright (c) 2025 Rix Beck

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
