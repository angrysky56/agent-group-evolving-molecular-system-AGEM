import fs from "fs/promises";
import path from "path";
import yaml from "yaml";

export interface AgentSkill {
  name: string;
  description: string;
  content: string; // The full markdown content
  metadata?: Record<string, string>;
}

export class SkillRegistry {
  private skills: Map<string, AgentSkill> = new Map();
  private skillsDir: string;

  constructor(basePath: string) {
    // Skills are at the project root (../../skills from interface/backend)
    this.skillsDir = path.resolve(basePath, "..", "..", "skills");
  }

  async initialize() {
    try {
      await fs.mkdir(this.skillsDir, { recursive: true });
      this.skills.clear(); // Support re-initialization
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadSkill(entry.name);
        }
      }
      console.log(`[SkillRegistry] Loaded ${this.skills.size} skills from ${this.skillsDir}`);
    } catch (error) {
      console.error(
        "[SkillRegistry] Failed to initialize skills directory:",
        error,
      );
    }
  }

  private async loadSkill(folderName: string) {
    const skillPath = path.join(this.skillsDir, folderName, "SKILL.md");
    try {
      const content = await fs.readFile(skillPath, "utf8");
      const parsed = this.parseFrontmatter(content);
      if (parsed) {
        // Ensure name matches folder or convention
        const skillName = parsed.frontmatter.name || folderName;
        this.skills.set(skillName, {
          name: skillName,
          description:
            parsed.frontmatter.description || "No description provided.",
          content: content,
          metadata: parsed.frontmatter.metadata,
        });
      }
    } catch (error) {
      // Skill missing SKILL.md or not readable, skip gracefully
      console.log(
        `[SkillRegistry] Skipping ${folderName}, no SKILL.md found or invalid format.`,
      );
    }
  }

  private parseFrontmatter(markdown: string) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;
    try {
      const frontmatter = yaml.parse(match[1]);
      return {
        frontmatter,
        body: match[2],
      };
    } catch (e) {
      return null;
    }
  }

  getSkill(name: string): AgentSkill | undefined {
    return this.skills.get(name);
  }

  getAllSkillsSummary(): string {
    if (this.skills.size === 0) {
      return "No additional skills currently available.";
    }
    let summary = "Available Skills:\n";
    for (const [name, skill] of this.skills.entries()) {
      summary += `- **${name}**: ${skill.description}\n`;
    }
    return summary;
  }

  getTools() {
    return [
      {
        type: "function",
        function: {
          name: "read_skill",
          description:
            "Read the full markdown instructions of a specific agent skill.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "The exact name of the skill to read (e.g., 'pdf-processing').",
              },
            },
            required: ["name"],
          },
        },
      },
    ];
  }

  executeTool(toolName: string, args: any) {
    if (toolName === "read_skill" && args.name) {
      const skill = this.getSkill(args.name);
      if (!skill) {
        return `Error: Skill '${args.name}' not found.`;
      }
      return skill.content;
    }
    return `Error: Unknown native tool ${toolName}`;
  }
}

// Export a singleton instance
export const skillRegistry = new SkillRegistry(process.cwd());
