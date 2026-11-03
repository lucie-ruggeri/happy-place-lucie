import { describe, expect, it } from "vitest";
import { buildIdeaContent } from "@/lib/dashboard";

describe("buildIdeaContent", () => {
  it("sépare titre et description par un saut de ligne", () => {
    expect(buildIdeaContent("Un titre", "Une description")).toBe("Un titre\nUne description");
  });
  it("ignore une partie vide et rogne les espaces", () => {
    expect(buildIdeaContent("  Un titre ", "")).toBe("Un titre");
    expect(buildIdeaContent("", " Une description ")).toBe("Une description");
  });
});
