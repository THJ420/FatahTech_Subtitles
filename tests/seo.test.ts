import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sitemap from "../app/sitemap";
import {
  FAQ_ITEMS,
  PARENT_ORGANIZATION_ID,
  SITE_CANONICAL,
  STRUCTURED_DATA,
} from "../lib/seo";

const graph: ReadonlyArray<Record<string, unknown>> = STRUCTURED_DATA["@graph"];

function entity(type: string): Record<string, unknown> | undefined {
  return graph.find((entry) => {
    const entryType = entry["@type"];
    return Array.isArray(entryType)
      ? entryType.includes(type)
      : entryType === type;
  });
}

test("structured data exposes the organization, website, app, breadcrumb, and FAQ entities", () => {
  const organization = entity("Organization");
  assert.ok(organization);
  assert.equal(organization["@id"], PARENT_ORGANIZATION_ID);
  assert.equal(organization.url, "https://fatahtech.com");

  const website = entity("WebSite");
  assert.ok(website);
  assert.equal(website.url, SITE_CANONICAL);
  assert.deepEqual(website.publisher, { "@id": PARENT_ORGANIZATION_ID });

  const app = entity("SoftwareApplication");
  assert.ok(app);
  assert.deepEqual(app["@type"], ["WebApplication", "SoftwareApplication"]);
  assert.equal(app.name, "FatahTech Subtitles");
  assert.equal(app.operatingSystem, "Web Browser");
  assert.equal(app.applicationCategory, "MultimediaApplication");
  assert.equal(app.isAccessibleForFree, true);
  assert.deepEqual(app.publisher, { "@id": PARENT_ORGANIZATION_ID });
  assert.deepEqual(app.offers, {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    url: SITE_CANONICAL,
  });
  assert.ok(Array.isArray(app.featureList));
  assert.ok((app.featureList as string[]).length >= 8);

  const breadcrumb = entity("BreadcrumbList");
  assert.ok(breadcrumb);
  const items = breadcrumb.itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(
    items.map((item) => item.position),
    [1, 2],
  );
  assert.equal(items[1].item, `${SITE_CANONICAL}#top`);

  const faq = entity("FAQPage");
  assert.ok(faq);
  const mainEntity = faq.mainEntity as Array<Record<string, unknown>>;
  assert.equal(mainEntity.length, FAQ_ITEMS.length);
  for (const [index, item] of mainEntity.entries()) {
    const answer = item.acceptedAnswer as Record<string, unknown>;
    assert.equal(item["@type"], "Question");
    assert.equal(item.name, FAQ_ITEMS[index].question);
    assert.equal(answer["@type"], "Answer");
    assert.equal(answer.text, FAQ_ITEMS[index].answer);
  }
});

test("FAQ content is unique, non-empty, and covers the target search intents", () => {
  const questions = FAQ_ITEMS.map((item) => item.question);
  assert.equal(new Set(questions).size, questions.length);
  for (const { question, answer } of FAQ_ITEMS) {
    assert.ok(question.trim().length > 10);
    assert.ok(answer.trim().length > question.trim().length);
  }
  const corpus = FAQ_ITEMS.map((item) => `${item.question} ${item.answer}`)
    .join(" ")
    .toLowerCase();
  for (const intent of [
    "free",
    "watermark",
    "uploaded to any server",
    "languages",
    "auto-caption",
    "srt or vtt",
  ]) {
    assert.ok(corpus.includes(intent), `FAQ is missing intent: ${intent}`);
  }
});

test("the sitemap and robots file point at the canonical host", () => {
  const entries = sitemap();
  assert.deepEqual(
    entries.map((entry) => entry.url),
    [SITE_CANONICAL, "https://subtitle.fatahtech.com/changelog/"],
  );
  assert.equal(entries[0].priority, 1);

  const robots = readFileSync(
    new URL("../public/robots.txt", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.match(
    robots,
    /^Sitemap: https:\/\/subtitle\.fatahtech\.com\/sitemap\.xml$/m,
  );
});
