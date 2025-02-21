import feedparser

def main():
    # Fetch RSS feed from your portfolio
    feed = feedparser.parse('https://www.prasen.dev/rss.xml')
    
    # Generate markdown for blog posts (latest 5)
    posts_md = []
    for entry in feed.entries[:5]:
        title = entry.title
        link = entry.link
        posts_md.append(f"- [{title}]({link})")
    
    blog_section = "\n".join(posts_md)
    
    # Read README
    with open('README.md', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace content between markers
    start_marker = "<!-- BLOG-POSTS:START -->"
    end_marker = "<!-- BLOG-POSTS:END -->"
    
    if start_marker not in content or end_marker not in content:
        print("Markers not found in README")
        return
        
    new_content = (
        content.split(start_marker)[0] + 
        start_marker + "\n" + 
        blog_section + "\n" + 
        end_marker + 
        content.split(end_marker)[1]
    )
    
    # Write updated README
    with open('README.md', 'w', encoding='utf-8') as f:
        f.write(new_content)

if __name__ == "__main__":
    main()