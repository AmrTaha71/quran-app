/*
# Rename link_url to link_content — semantic shift

## Problem
The "ayah_links" table originally stored URLs (link_url). However, the concept of
"rawabet" (روابط) in this app means mnemonic markers — words, concepts, signs,
and patterns that help memorize Quranic verses, NOT electronic hyperlinks.

## Changes
1. Rename column `link_url` to `link_content` (text, NOT NULL)
2. Change `link_title` to remain optional but now serves as a short label for the marker

## Security
No RLS or policy changes — same ownership model applies.
*/

ALTER TABLE ayah_links RENAME COLUMN link_url TO link_content;
