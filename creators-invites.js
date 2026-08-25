/**
 * MAGIC BOTS LAB — the messages creators send to build a team.
 *
 * Seven of them, because fifty people sending the identical paragraph is what
 * a group chat learns to scroll past — and because the message that works on
 * a friend is not the one that works on a sceptic. Whichever sits at the top
 * of the list is what gets copied: a starred one if they starred one,
 * otherwise a random pick that visit.
 *
 * Every version says the same true things: the bots are free, there is nothing
 * to pay to join, and the money is monthly.
 */

window.MBL_INVITES = [
  {
    key: "straight",
    label: "Straight up",
    body: function (link) {
      return [
        "I get paid to post about this.",
        "",
        "Magic Bots Lab has free automated trading bots — and it pays creators to make short videos about them. $100 your first month, and it goes up from there. One video a day, on your own accounts.",
        "",
        "Nothing to pay, nothing to buy. Go check it out:",
        link
      ].join("\n");
    }
  },
  {
    key: "friend",
    label: "To a friend",
    body: function (link) {
      return [
        "This is the thing I have been posting about.",
        "",
        "It is free trading bots, and they pay you to make short videos about them. I am on $100 this month and it goes up every month after.",
        "",
        "You already post anyway. Go check it out and tell me what you think:",
        link
      ].join("\n");
    }
  },
  {
    key: "creator",
    label: "To another creator",
    body: function (link) {
      return [
        "If you are already posting daily, this pays for it.",
        "",
        "Magic Bots Lab pays creators monthly to post about their free trading bots. Starts at $100 and climbs. Your accounts, your content, and you are not tied to anything.",
        "",
        "Go check it out — two minutes to see if it is for you:",
        link
      ].join("\n");
    }
  },
  {
    key: "short",
    label: "Very short",
    body: function (link) {
      return [
        "Free automated trading bots, and they pay you to post about them. $100 a month to start.",
        "",
        "Go check it out:",
        link
      ].join("\n");
    }
  },
  {
    key: "sceptic",
    label: "For a sceptic",
    body: function (link) {
      return [
        "Before you say it — there is nothing to buy and nothing to pay.",
        "",
        "The bots are free. They pay creators to make videos about them, $100 the first month and more after that. That is the whole thing.",
        "",
        "Go check it out yourself rather than taking my word for it:",
        link
      ].join("\n");
    }
  },
  {
    key: "sidework",
    label: "Extra income",
    body: function (link) {
      return [
        "Looking for something that pays without a boss or a schedule?",
        "",
        "Post one short video a day about Magic Bots Lab's free trading bots and get paid every month. $100 to start. You post on your own accounts, whenever you like.",
        "",
        "Go check it out:",
        link
      ].join("\n");
    }
  },
  {
    key: "group",
    label: "To a group",
    body: function (link) {
      return [
        "Dropping this here for anyone who posts.",
        "",
        "Magic Bots Lab pays creators monthly to make short videos about their free trading bots. $100 the first month and it goes up as you keep going. Nothing to pay to join.",
        "",
        "Go check it out:",
        link
      ].join("\n");
    }
  }
];
