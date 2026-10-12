"""Bunkr, for the download backend (server.mjs runs this as a subprocess).

Bunkr changes how its files are reached every few months, and gallery-dl
keeps up with it, so this borrows gallery-dl's Bunkr extractor rather than
reimplementing it:

  bunkr.py list <url>        what an album (or one file's page) holds:
                             {"title", "host", "files": [{"id", "name", "size"}]}
  bunkr.py file <host> <id>  where one file is right now:
                             {"url", "headers"}

Listing reads the album page only. gallery-dl would also ask Bunkr to sign
every file's address up front (two requests each, and the signatures go
stale), so that step is held back until a file is actually wanted.

Prints one JSON object. On failure: {"error": ...} and exit code 1.
"""

import json
import sys

from gallery_dl import config, extractor

# Bunkr moves between top-level domains; accept any bunkr.<tld>. Read when the
# extractor module is first imported, so it has to be set before find().
config.set(("extractor", "bunkr"), "tlds", True)


def bunkr(url):
    found = extractor.find(url)
    if found is None or found.category != "bunkr":
        raise ValueError("That isn't a Bunkr album or file link.")
    found.initialize()
    return found


def listing(url):
    ex = bunkr(url)
    ex._extract_file = lambda data_id: {"file": "", "id_url": data_id}
    files, album = ex.fetch_album(ex.album_id)
    out = []
    for file in files:
        if not file.get("id_url"):
            continue
        out.append({
            "id": str(file["id_url"]),
            "name": file.get("name") or file.get("slug") or "",
            "size": file.get("size") or None,
        })
    return {
        "title": album.get("album_name") or "",
        # The domain that answered, which is the one to ask for the files.
        "host": ex.root.partition("//")[2],
        "files": out,
    }


def locate(host, data_id):
    ex = bunkr("https://" + host + "/a/x")
    file = ex._extract_file(data_id)
    return {"url": file["file"], "headers": file.get("_http_headers") or {}}


def main(argv):
    if len(argv) == 3 and argv[1] == "list":
        return listing(argv[2])
    if len(argv) == 4 and argv[1] == "file":
        return locate(argv[2], argv[3])
    raise ValueError("usage: bunkr.py list <url> | file <host> <id>")


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv)))
    except Exception as exc:  # anything at all is the caller's "couldn't"
        print(json.dumps({"error": str(exc) or exc.__class__.__name__}))
        sys.exit(1)
