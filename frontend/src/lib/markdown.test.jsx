import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks } from "./markdown";

describe("safe Markdown for Copilot answers", () => {
  it("renders the supported subset", () => {
    const text = [
      "### Summary",
      "**Z01** is *highest* with `63.43`.",
      "",
      "- first",
      "  continued",
      "- second",
      "",
      "1. one",
      "2. two",
      "",
      "| Zone | Score |",
      "| --- | ---: |",
      "| Z01 | 63.43 |",
      "",
      "```",
      "code <b>",
      "```",
    ].join("\n");
    const { container } = render(<Markdown text={text} />);
    expect(screen.getByRole("heading", { name: "Summary", level: 3 })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("Z01");
    expect(container.querySelector("em")).toHaveTextContent("highest");
    expect(container.querySelector("p code")).toHaveTextContent("63.43");
    expect(container.querySelector("ul").children).toHaveLength(2);
    expect(container.querySelector("ul li")).toHaveTextContent("first continued");
    expect(container.querySelector("ol").children).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Zone" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "63.43" })).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("code <b>");
  });

  it("never creates HTML, links or images from model text", () => {
    const text = 'Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> [click](javascript:alert(3)) ![x](https://evil.example/a.png) <a href="https://evil.example">bad</a>';
    const { container } = render(<Markdown text={text} />);
    expect(container.querySelector("script, img, a, iframe")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(container).toHaveTextContent("click");
    expect(container.textContent).not.toContain("javascript:alert(3)");
  });

  it("leaves identifiers with underscores and arithmetic asterisks alone", () => {
    const { container } = render(<Markdown text={"low_green_cover_score and 0.35 * 100 * 2"} />);
    expect(container.querySelector("em")).toBeNull();
    expect(container).toHaveTextContent("low_green_cover_score and 0.35 * 100 * 2");
  });

  it("parses empty and odd input without throwing", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks("```\nunterminated")).toEqual([{ type: "code", text: "unterminated" }]);
    expect(parseBlocks("a | b\nnot a table").map((block) => block.type)).toEqual(["paragraph"]);
  });
});
