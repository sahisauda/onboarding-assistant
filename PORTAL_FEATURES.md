# Ranosys AI Assistant - Product Overview & Roadmap

## Executive Summary
The Ranosys AI Assistant is a secure, context-aware conversational agent integrated directly into the Ranosys Google Workspace ecosystem. It securely indexes designated Google Drive folders to provide incredibly fast, accurate, and context-specific answers to employees. By leveraging Retrieval-Augmented Generation (RAG) and Google OAuth, the portal ensures that users only see insights from documents they are explicitly authorized to access.

---

## Current Capabilities

### 1. Seamless Google Workspace Integration
- **Single Sign-On (SSO):** Users authenticate securely using their existing Ranosys Google accounts.
- **Drive Context:** The AI reads documents directly from defined Google Drive folders (Docs, Sheets, PDFs, etc.) to base its answers strictly on verified company data.
- **Dynamic Context Building:** The system fetches and chunks the latest files from Drive into a fast Vector Store for immediate semantic search.

### 2. Intelligent Chat Interface
- **Streaming Responses:** Real-time token streaming provides a fluid and instant chat experience.
- **Contextual Awareness:** The AI understands the user's role (e.g., Software Engineer, Marketing) and tailors its responses to their specific perspective.
- **Proactive Suggestions & Automation:** Suggests follow-up questions and can even draft or send emails based on the context of the conversation.

### 3. Role-Based Access Control (RBAC) & Custom Folder Tagging
- **Strict Data Isolation:** Employees are only allowed to query folders they have been explicitly assigned to.
- **Role Differentiation:** Users are categorized as `admin` or `employee`, ensuring tight control over configuration.

---

## The Admin Panel (Recent Highlights & POCs)

We recently developed and tested advanced administrative capabilities to showcase how the portal can scale across different departments:

* **Deployment Center:** A dedicated UI for administrators to instantly deploy new "Knowledge Sources."
* **Custom Google Drive Folder Tagging:** Admins can paste *any* Google Drive Folder ID, verify its name instantly via the Google Drive API, and tag it as a new data source.
* **Bulk User Assignment:** Admins can assign specific folders to specific users (or a comma-separated list of emails). 
* **Automated Notifications:** When an admin grants a user access to a new folder, the system completely automates the onboarding by sending a personalized welcome email with the portal link directly to the new user.

---

## Future Roadmap & Potential Advanced Pointers

To scale this portal from a proof-of-concept into an enterprise-wide foundational tool, the following advanced features are recommended for the roadmap:

### 1. Advanced Document & Folder Management
* **Multi-Folder Simultaneous Querying:** Allow users to query across *multiple* assigned folders at the exact same time, synthesizing answers from diverse departments (e.g., HR + IT).
* **Automated Data Syncing (Webhooks):** Instead of building the context on-the-fly, implement Google Drive Push Notifications to update the vector database instantly whenever a document is edited.
* **File-Level Granularity:** Extend RBAC down to the individual file level, strictly mirroring the native Google Drive permissions of the authenticated user.

### 2. Enterprise Admin Capabilities
* **Google Workspace Group Sync:** Automatically assign folder access based on the user's Google Workspace Groups (e.g., automatically grant the `HR-Docs` folder to anyone in the `hr-team@ranosys.com` group).
* **Comprehensive Analytics Dashboard:** Provide admins with visual metrics on total messages, active users, top search intents, and—most importantly—identify questions the AI *could not* answer, highlighting gaps in company documentation.
* **Granular Permission Tiers:** Implement custom roles like `Department Manager` who can assign folders only within their specific scope.

### 3. Expanded AI Agentic Actions
* **Calendar & Gmail Integration:** Evolve the AI from answering questions to taking action. For example, "Find a 30-minute slot where John and I are free tomorrow and book a meeting about the new policy."
* **Custom Persona Fine-Tuning:** Define specific AI system prompts per folder (e.g., the IT folder AI responds with technical troubleshooting steps; the HR folder AI responds with empathetic guidance).
* **Voice-First Mobile Optimization:** Enhance the existing voice command implementation to support fully hands-free interactions for employees on the go.
