#!/usr/bin/env python3
"""
Updates the live GitHub stats inside dark_mode.svg and light_mode.svg.

Runs daily via .github/workflows/profile-card.yml using the built-in
GITHUB_TOKEN (an ACCESS_TOKEN secret also works and takes priority).
Inspired by Andrew6rant's profile card (github.com/Andrew6rant).

Stats collected:
  - uptime (time since the GitHub account was created)
  - public repos owned + repos contributed to
  - total stars across owned repos
  - total commits (default branches, via the commit search API)
  - followers
  - lines of code added/deleted across owned non-fork repos
"""

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
from xml.etree import ElementTree

USER = "StarKnightt"
API = "https://api.github.com"
TOKEN = os.environ.get("ACCESS_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
SVG_FILES = ["dark_mode.svg", "light_mode.svg"]

# len(dots) + len(value) stays constant so columns line up.
# Must match the initial layout of the SVGs.
JUSTIFY = {
    "repo_data": 6,
    "star_data": 10,
    "commit_data": 10,
    "follower_data": 13,
    "loc_data": 10,
}


def api_get(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": USER}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.load(resp)


def graphql(query, variables):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": USER,
    }
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(f"{API}/graphql", data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def get_user():
    _, data = api_get(f"{API}/users/{USER}")
    return data


def get_owned_repos():
    repos, page = [], 1
    while True:
        _, batch = api_get(f"{API}/users/{USER}/repos?per_page=100&page={page}&type=owner")
        repos.extend(batch)
        if len(batch) < 100:
            return repos
        page += 1


def commit_count():
    _, data = api_get(f"{API}/search/commits?q=author:{USER}&per_page=1")
    return data.get("total_count", 0)


def contributed_count():
    """Repos (not owned by the user) that the user has contributed to. GraphQL only."""
    if not TOKEN:
        return None
    query = """
    query($login: String!) {
      user(login: $login) {
        repositoriesContributedTo(
          first: 1,
          includeUserRepositories: false,
          contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]
        ) { totalCount }
      }
    }"""
    try:
        data = graphql(query, {"login": USER})
        return data["data"]["user"]["repositoriesContributedTo"]["totalCount"]
    except Exception as exc:  # noqa: BLE001 - stat is optional, never fail the run
        print(f"contributed_count unavailable: {exc}")
        return None


def loc_stats(repos):
    """Sum additions/deletions authored by USER across owned non-fork repos."""
    additions = deletions = 0
    for repo in repos:
        if repo.get("fork") or repo.get("size") == 0:
            continue
        url = f"{API}/repos/{repo['full_name']}/stats/contributors"
        for attempt in range(6):
            try:
                status, data = api_get(url)
            except urllib.error.HTTPError as exc:
                if exc.code in (403, 429):
                    print(f"rate limited at {repo['full_name']}; LOC totals are partial")
                    return additions, deletions
                print(f"skipping {repo['full_name']}: HTTP {exc.code}")
                break
            if status == 202:  # stats are being computed, retry
                time.sleep(3)
                continue
            for contributor in data or []:
                if (contributor.get("author") or {}).get("login") == USER:
                    for week in contributor.get("weeks", []):
                        additions += week.get("a", 0)
                        deletions += week.get("d", 0)
            break
    return additions, deletions


def uptime(created_at):
    """Human readable time since account creation, e.g. '4 years, 10 months, 10 days'."""
    born = datetime.datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ").date()
    today = datetime.date.today()
    years = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    months = today.month - born.month - (today.day < born.day)
    if months < 0:
        months += 12
    # days since the last monthly "anniversary"
    last_anniv_month = today.month if today.day >= born.day else today.month - 1
    last_anniv_year = today.year
    if last_anniv_month < 1:
        last_anniv_month += 12
        last_anniv_year -= 1
    day = min(born.day, 28)
    days = (today - datetime.date(last_anniv_year, last_anniv_month, day)).days

    def plural(n, word):
        return f"{n} {word}{'' if n == 1 else 's'}"

    return f"{plural(years, 'year')}, {plural(months, 'month')}, {plural(days, 'day')}"


def find_by_id(root, element_id):
    return root.find(f".//*[@id='{element_id}']")


def justify_format(root, element_id, new_text):
    if isinstance(new_text, int):
        new_text = f"{new_text:,}"
    new_text = str(new_text)
    element = find_by_id(root, element_id)
    if element is not None:
        element.text = new_text
    length = JUSTIFY.get(element_id, 0)
    dots_el = find_by_id(root, f"{element_id}_dots")
    if dots_el is None:
        return
    just = max(0, length - len(new_text))
    if just <= 2:
        dots_el.text = {0: "", 1: " ", 2: ". "}[just]
    else:
        dots_el.text = " " + "." * just + " "


def update_svg(filename, values):
    ElementTree.register_namespace("", "http://www.w3.org/2000/svg")
    tree = ElementTree.parse(filename)
    root = tree.getroot()
    for element_id, value in values.items():
        if value is None:
            continue
        justify_format(root, element_id, value)
    tree.write(filename, encoding="utf-8", xml_declaration=False)


def main():
    user = get_user()
    repos = get_owned_repos()
    stars = sum(r.get("stargazers_count", 0) for r in repos)
    commits = commit_count()
    contributed = contributed_count()
    loc_add, loc_del = loc_stats(repos)

    values = {
        "age_data": uptime(user["created_at"]),
        "repo_data": user.get("public_repos", len(repos)),
        "contrib_data": contributed,
        "star_data": stars,
        "commit_data": commits,
        "follower_data": user.get("followers", 0),
        "loc_data": loc_add - loc_del,
        "loc_add": loc_add,
        "loc_del": loc_del,
    }
    print(json.dumps({k: v for k, v in values.items()}, indent=2))

    for svg in SVG_FILES:
        update_svg(svg, values)
        print(f"updated {svg}")


if __name__ == "__main__":
    sys.exit(main())
