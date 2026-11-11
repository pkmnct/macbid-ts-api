import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Runs the release plugins' commit analysis and release-notes generation with
// the repository's own .releaserc.json, so a preset/writer mismatch or a
// config that stops recognising `feat!:` fails here instead of in the release
// run on main (which is also the publish).

type PluginConfig = Record<string, unknown>;
type Context = Record<string, unknown>;
type Analyze = (config: PluginConfig, context: Context) => Promise<string | null>;
type Notes = (config: PluginConfig, context: Context) => Promise<string>;

const load = async <T>(name: string): Promise<T> => (await import(name)) as T;

const releaseConfig = JSON.parse(readFileSync(".releaserc.json", "utf8")) as {
  plugins: (string | [string, PluginConfig])[];
};

const optionsFor = (name: string): PluginConfig => {
  const entry = releaseConfig.plugins.find(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name
  );
  assert.ok(entry, `${name} is not in .releaserc.json`);
  return Array.isArray(entry) ? entry[1] : {};
};

const commit = (message: string) => ({
  hash: "9aea5015519e76ff4a252d757032c302384d9853",
  message,
  committerDate: new Date().toISOString(),
});

const logger = { log: () => undefined };

describe("release configuration", () => {
  it("maps conventional commit titles to release types", async () => {
    const { analyzeCommits } = await load<{ analyzeCommits: Analyze }>(
      "@semantic-release/commit-analyzer"
    );
    const typeOf = (message: string) =>
      analyzeCommits(optionsFor("@semantic-release/commit-analyzer"), {
        cwd: process.cwd(),
        commits: [commit(message)],
        logger,
      });

    assert.equal(await typeOf("feat!: drop node 16"), "major");
    assert.equal(await typeOf("feat: add a method"), "minor");
    assert.equal(await typeOf("fix: handle an empty body"), "patch");
    assert.equal(await typeOf("ci: change a workflow"), null);
  });

  it("generates release notes with the configured preset", async () => {
    const { generateNotes } = await load<{ generateNotes: Notes }>(
      "@semantic-release/release-notes-generator"
    );
    const notes = await generateNotes(
      optionsFor("@semantic-release/release-notes-generator"),
      {
        cwd: process.cwd(),
        options: { repositoryUrl: "https://github.com/pkmnct/macbid-ts-api.git" },
        commits: [commit("feat!: drop node 16\n\nBREAKING CHANGE: Node 22+")],
        lastRelease: { gitTag: "v1.1.0", version: "1.1.0" },
        nextRelease: { gitTag: "v2.0.0", version: "2.0.0", gitHead: "9aea501" },
        logger,
      }
    );

    assert.match(notes, /## \[2\.0\.0\]/);
    assert.match(notes, /BREAKING CHANGES/);
  });
});
