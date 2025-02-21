import feedparser
from datetime import datetime
import pytz

def format_date(date_str):
    try:
        # Parse the date string to datetime object
        dt = datetime.strptime(date_str, '%a, %d %b %Y %H:%M:%S %z')
        # Format to a more readable string
        return dt.strftime('%B %d, %Y')
    except:
        return date_str

def main():
    # Fetch RSS feed
    feed = feedparser.parse('https://www.prasen.dev/rss.xml')
    
    # Generate markdown for blog posts
    posts_md = []
    for entry in feed.entries[:5]:  # Get latest 5 posts
        title = entry.title
        link = entry.link
        date = format_date(entry.published)
        posts_md.append(f"- [{title}]({link}) - {date}")
    
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