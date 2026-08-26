import "server-only";
// Import each tool module for its registration side-effect. Adding a new tool is
// a one-line import here plus its own file — nothing else in the engine changes.
import "./data-analysis";
import "./document-intel";
import "./image-vision";

export { pickTool, allTools, type ToolInput, type ToolResult, type ToolAttachment } from "./registry";
