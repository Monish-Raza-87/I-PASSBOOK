// faq-content.js — THE Help & FAQ, and the only copy of it.
//
// ── Why this file exists ───────────────────────────────────────────────────────
// The FAQ used to be one hand-written page, faq.html, linked from the sign-in screen
// and from the sidebar. On 2026-10-08 the owner asked for it inside the app instead —
// "our FAQ page is opening in a new tab, that is not good for us. It has to be in our
// app, as per our UI and a part of our app" — and the easy way to do that would have
// been to paste the answers into app.js and leave the page where it was.
//
// That is the shape this repo keeps refusing: two copies of one text, drifting, with
// nothing to say which one is right. So the content lives HERE and nowhere else, and
// there are two renderers that read it:
//
//   app.js             #/faq — the view inside the shell, in the app's own skin
//   tools/build-faq.mjs  faq.html — the same answers as a standalone page, which the
//                        SIGN-IN screen still needs, because a person who cannot get
//                        in must still be able to read why.
//
// Change a sentence here and both follow. tools/smoke-door-faq.mjs fails if either one
// stops being built from this file.
//
// It is a CLASSIC script, not a module: app.js is a classic script and cannot import.
// It assigns to window so the browser can read it, and tools/build-faq.mjs evaluates it
// in a bare window to read the same object from Node.
//
// ── The shape ──────────────────────────────────────────────────────────────────
//   { eyebrow, title, standfirst, jump, sections[], footer[] }
//   section: { id, title, items[] }   item: { q, blocks[] }
//   block:   { t:'p', html } | { t:'callout', ok, ct, html } | { t:'ul', items[] }
//
// `html` is raw inner markup and is authored here, in this file, by us — it is never
// user input and never a value from the store. The two things it carries are the
// <strong> inside a sentence and the one external link to the problem-report form.

window.FAQ_CONTENT = {
  "eyebrow": "I-PASSBOOK",
  "title": "Help & FAQ",
  "standfirst": "Everything on this page describes what the app actually does — nothing here is a plan, a policy or a promise about the future. If an answer here disagrees with what you see on screen, the screen is right and the page is out of date: tell the service desk.",
  "jump": [
    {
      "id": "getting-in",
      "title": "Getting in"
    },
    {
      "id": "passwords",
      "title": "Codes & passwords"
    },
    {
      "id": "finding",
      "title": "Finding an IR"
    },
    {
      "id": "ticket",
      "title": "Working a ticket"
    },
    {
      "id": "charts",
      "title": "Reading the charts"
    },
    {
      "id": "permissions",
      "title": "Who can edit what"
    },
    {
      "id": "logs",
      "title": "The Log Analyser"
    },
    {
      "id": "customer",
      "title": "Reporting a problem"
    },
    {
      "id": "data",
      "title": "Your data and your device"
    },
    {
      "id": "trouble",
      "title": "When something looks wrong"
    }
  ],
  "sections": [
    {
      "id": "getting-in",
      "title": "Getting in",
      "items": [
        {
          "q": "How do I get an account?",
          "blocks": [
            {
              "t": "p",
              "html": "An administrator creates it for you. There is no sign-up screen and no way to\nrequest one from inside the app — an account is made, and its details are handed\nto you."
            }
          ]
        },
        {
          "q": "It is my first time. What will I see?",
          "blocks": [
            {
              "t": "p",
              "html": "You sign in with the temporary password you were given, and the app asks you to\nset a password of your own before it lets you any further. Until you do, the\napp is presentation only — it holds no session for you and there is nothing\nbehind that screen to reach."
            }
          ]
        },
        {
          "q": "Do I type a password every morning?",
          "blocks": [
            {
              "t": "p",
              "html": "No. Day to day you give your email address, the app emails you a six-digit code,\nand you type that. The password door is still there if you would rather use it."
            }
          ]
        },
        {
          "q": "Can I unlock faster than that?",
          "blocks": [
            {
              "t": "p",
              "html": "On a device you have already signed in on, yes — with your fingerprint, or with a\npattern. This is a local unlock on that device and it is set up from inside the\napp once you are already signed in."
            }
          ]
        },
        {
          "q": "Can I stay signed in on my laptop and my phone at once?",
          "blocks": [
            {
              "t": "p",
              "html": "No, and this is deliberate. One device stays signed in per account: signing in on\nyour phone signs the earlier device out. If you have been signed out somewhere\nyou did not expect, this is almost always why."
            }
          ]
        }
      ]
    },
    {
      "id": "passwords",
      "title": "Codes & passwords",
      "items": [
        {
          "q": "How long does the emailed code last?",
          "blocks": [
            {
              "t": "p",
              "html": "Eight and a half hours from the moment it is emailed — a working day. The clock\nstarts when the mail is sent, so a code requested at 2pm is good until 10:30pm.\nWithin that window the <strong>same</strong> code works for every sign-in; you do\nnot need a fresh one each time."
            }
          ]
        },
        {
          "q": "Someone asked me for my code. Should I give it?",
          "blocks": [
            {
              "t": "callout",
              "ok": false,
              "ct": "Never share it",
              "html": "A sign-in code is the same thing as your signature. Nobody at the service desk\nneeds it, and nobody should ever ask for it. If you get such a request, report\nit."
            }
          ]
        },
        {
          "q": "I typed the code wrong a few times.",
          "blocks": [
            {
              "t": "p",
              "html": "The code burns itself out after five wrong attempts, whatever time is left on it.\nRequest a new one. Repeated wrong attempts also lock that email's door for\nfifteen minutes — if you are certain the code is right and it still refuses, wait\na quarter of an hour rather than trying again and again."
            }
          ]
        },
        {
          "q": "I have forgotten my password.",
          "blocks": [
            {
              "t": "p",
              "html": "Use the reset link on the sign-in screen. If you normally sign in with a code\ninstead, you can simply keep doing that — the password is an optional door, not\nthe front one."
            }
          ]
        },
        {
          "q": "I did not try to sign in, but I got a code.",
          "blocks": [
            {
              "t": "p",
              "html": "Then someone else is trying to get in with your email. Tell an administrator\nstraight away. Do not forward the code to anyone, including the person who asked."
            }
          ]
        }
      ]
    },
    {
      "id": "finding",
      "title": "Finding an IR",
      "items": [
        {
          "q": "How do I find one ticket?",
          "blocks": [
            {
              "t": "p",
              "html": "Type into the search box on the IR list — it matches the IR number and the drone\nID. The filters narrow the same list by year, month, status, category and\ncustomer."
            }
          ]
        },
        {
          "q": "What is the board view?",
          "blocks": [
            {
              "t": "p",
              "html": "The IR list has a <strong>List / Board</strong> switch. The board shows the same\ntickets as cards in columns, one column per stage of the job. It is the same list\nseen sideways, so the search box and every filter apply to both — switch between\nthem without losing what you had typed."
            }
          ]
        },
        {
          "q": "What is Legacy Records?",
          "blocks": [
            {
              "t": "p",
              "html": "The old workbook, shown read-only in a frame. It is there so you can still reach\nwork that predates the app, and it stays current alongside it. Nothing you do in\nthat frame changes the app."
            }
          ]
        },
        {
          "q": "Where is the site?",
          "blocks": [
            {
              "t": "p",
              "html": "On the ticket, the site location is written out as text with a link beside it.\nTapping the link opens that place in Google Maps. Nothing is loaded from Google —\nand no location leaves your device — until you tap it."
            }
          ]
        }
      ]
    },
    {
      "id": "ticket",
      "title": "Working a ticket",
      "items": [
        {
          "q": "What do the sections mean?",
          "blocks": [
            {
              "t": "p",
              "html": "A ticket has an Overview and six numbered sections — B inward checklist, C IQC\nvisual inspection, D investigation, E production/rework, F quality test, G PDI and\ndispatch. Each section is a form with its own Save."
            }
          ]
        },
        {
          "q": "\"3 of 6 sections saved\" — does that mean the ticket is finished?",
          "blocks": [
            {
              "t": "p",
              "html": "No, and the wording is careful about it. The count records that a section's\n<strong>Save button was pressed</strong>, not that the section was filled in\nfully. A section saved once stays counted, so treat the number as progress, never\nas a completion certificate."
            }
          ]
        },
        {
          "q": "What moves a ticket forward?",
          "blocks": [
            {
              "t": "p",
              "html": "A person does, deliberately. Saving a section never moves the workflow on by\nitself — no status changes behind your back, and no clock starts on its own. The\nstatus changes when someone sets it in Allot CAPS, or presses the move button that\nappears on a card on the board."
            }
          ]
        },
        {
          "q": "What does the status mean?",
          "blocks": [
            {
              "t": "p",
              "html": "The status is the stage of the job, from Open and Remote Support through Inward,\nVisual Inspection, QC Investigation, Production, QC and Flight Test to PDI,\nApproval, Delivered and Close. Hold and Other are outside that run. On the board\nthese are grouped into columns, so \"Not started\" covers Open and Remote Support\nand \"Finished\" covers Delivered, Close and Other."
            }
          ]
        },
        {
          "q": "When is a ticket counted as late?",
          "blocks": [
            {
              "t": "p",
              "html": "It depends on priority, counted from the last time its status changed:"
            },
            {
              "t": "ul",
              "items": [
                "<strong>Urgent</strong> — more than 1 day",
                "<strong>High</strong> — more than 3 days",
                "<strong>Medium</strong> — more than 7 days",
                "<strong>Low</strong> — more than 14 days"
              ]
            },
            {
              "t": "p",
              "html": "A ticket with no priority is treated as 14 days. Only tickets that are actually\nstill open can be late — a Delivered or Closed ticket is never flagged, however\nlong it sat there."
            }
          ]
        },
        {
          "q": "What does the number beside an assignee mean?",
          "blocks": [
            {
              "t": "p",
              "html": "Who the ticket is with. The IR list shows it next to the IR number. \"Unassigned\"\nmeans nobody has been given it yet, and it is a real state, not a gap to ignore."
            }
          ]
        }
      ]
    },
    {
      "id": "charts",
      "title": "Reading the charts",
      "items": [
        {
          "q": "What is on the Insights screen?",
          "blocks": [
            {
              "t": "p",
              "html": "Three headline figures — raised, open now, and late now — then how many were\nraised in each of the last twelve months, the spread of statuses, how REPAIR\ntickets break down by sub-category, and a card per person with how many they have\nopen and how many are late."
            }
          ]
        },
        {
          "q": "The chart total does not match the list. Which is wrong?",
          "blocks": [
            {
              "t": "p",
              "html": "Neither, usually — they are answering different questions. The charts read every\nticket; the list reads what your filters and search have left. Clear the filters\nand the two agree."
            }
          ]
        },
        {
          "q": "Why is there a \"No date\" bar?",
          "blocks": [
            {
              "t": "p",
              "html": "Because some tickets genuinely have no date on them. Leaving them out would make\nthe bars add up to less than the total printed above them, and a chart that\nsilently disagrees with its own headline is worse than one that admits the gap."
            }
          ]
        },
        {
          "q": "Why is there an \"Unassigned\" row under People?",
          "blocks": [
            {
              "t": "p",
              "html": "For the same reason. It is shown even when it is zero, so the numbers in that card\nalways add up to the total rather than quietly leaving out whoever nobody has\npicked up yet."
            }
          ]
        },
        {
          "q": "Does it show departments?",
          "blocks": [
            {
              "t": "p",
              "html": "No. An IR does not carry a department, so a department chart would be inventing\none. It counts assignees, because that is what the data actually has."
            }
          ]
        }
      ]
    },
    {
      "id": "permissions",
      "title": "Who can edit what",
      "items": [
        {
          "q": "Can I see everything?",
          "blocks": [
            {
              "t": "p",
              "html": "Everyone signed in can read and comment on every ticket and its six sections, and\nthe Overview. That is the same for all accounts."
            }
          ]
        },
        {
          "q": "Then what is restricted?",
          "blocks": [
            {
              "t": "p",
              "html": "Editing. Whether you can change a section is set per account, per department, and\na section can be given to more than one department so that more than one team can\nwork on it."
            }
          ]
        },
        {
          "q": "I can read a section but the Save button will not work.",
          "blocks": [
            {
              "t": "p",
              "html": "Then that section has not been granted to a department you belong to. It is yours\nto read and comment on, not to change. Ask an administrator if you should have it."
            }
          ]
        },
        {
          "q": "Who can set the status and priority?",
          "blocks": [
            {
              "t": "p",
              "html": "Allot CAPS — Customer Relations and Management. It is a separate permission from\nsection editing: a person can be able to work a section without being able to\nchange the stage the ticket is at."
            }
          ]
        }
      ]
    },
    {
      "id": "logs",
      "title": "The Log Analyser",
      "items": [
        {
          "q": "What does it do?",
          "blocks": [
            {
              "t": "p",
              "html": "It reads an ArduPilot flight log from a drone's removable card and reports what is\nin it — the flight, the vibration and GPS quality, and any errors the flight\ncontroller recorded."
            }
          ]
        },
        {
          "q": "Does the log file get uploaded anywhere?",
          "blocks": [
            {
              "t": "callout",
              "ok": true,
              "ct": "No",
              "html": "The file is opened and read entirely inside your browser, on your own device.\nThe log never leaves the machine you opened it on, and nothing about it is sent\nto the service desk or anyone else."
            }
          ]
        },
        {
          "q": "Can I keep the result with the ticket?",
          "blocks": [
            {
              "t": "p",
              "html": "Yes. You can push the report onto the investigation section of an IR so the\nfinding sits with the ticket rather than in a file on one laptop."
            }
          ]
        },
        {
          "q": "The numbers it quotes — where do they come from?",
          "blocks": [
            {
              "t": "p",
              "html": "The thresholds are ArduPilot's own published guidance, not this app's opinion.\nThe analyser reads the log and applies those numbers; it is a reader, not a judge,\nand it will not tell you a flight was fine."
            }
          ]
        }
      ]
    },
    {
      "id": "customer",
      "title": "Reporting a problem",
      "items": [
        {
          "q": "I do not have an account. Can I report a fault?",
          "blocks": [
            {
              "t": "p",
              "html": "Yes. You do not need an account in this app, and nothing on the sign-in screen\nasks who you are."
            },
            {
              "t": "p",
              "html": "There is one thing to expect before you start. The report form is made with\nGoogle Forms and it records the email address you send from, so Google asks you\nto sign in to a Google account before it will show you the form. That request\ncomes from Google, not from this app — a device already signed in to Google goes\nstraight to the form with no prompt at all."
            },
            {
              "t": "p",
              "html": "On the sign-in screen, <strong>Report a problem</strong> says so up front and\ngives you a single button that opens the form in a new tab, which is where that\nsign-in works."
            },
            {
              "t": "p",
              "html": "If you have come straight to this page and cannot get back to the sign-in screen,\nthe form is here as well:"
            },
            {
              "t": "p",
              "html": "<a href=\"https://docs.google.com/forms/d/e/1FAIpQLScKxygN_FWBo_pD-uc9g6y5fPx4Mc0BB7pyA8Vy2BPTXAkJlw/viewform\"\ntarget=\"_blank\" rel=\"noopener noreferrer\">Open the problem report form &rarr;</a>"
            }
          ]
        },
        {
          "q": "What can I see from there?",
          "blocks": [
            {
              "t": "p",
              "html": "The form, and this page. Nothing else. That entry reads no ticket, no customer\nname and no IR number — it is a way in, not a window. Everything else in the app\nis behind a sign-in."
            },
            {
              "t": "p",
              "html": "Opening it does not put the form anywhere near the app either. The form is never\nloaded into this app's own screen, so pressing that button is the first and only\nthing that contacts Google."
            }
          ]
        },
        {
          "q": "Who receives what I send?",
          "blocks": [
            {
              "t": "p",
              "html": "It goes to the service desk exactly as it does today, through the same form. The\nform is hosted by Google. Nothing is loaded from Google until you press the button\nthat opens it — and if you never press it, nothing is."
            }
          ]
        }
      ]
    },
    {
      "id": "data",
      "title": "Your data and your device",
      "items": [
        {
          "q": "Where does the app keep the records?",
          "blocks": [
            {
              "t": "p",
              "html": "In a store in the organisation's own Google Drive, reached through the service\ndesk's own backend. It is not a hosted product and no third-party service holds\nyour tickets."
            }
          ]
        },
        {
          "q": "What leaves my device?",
          "blocks": [
            {
              "t": "p",
              "html": "Only what the app needs to do its job: your sign-in, and the saves you press.\nFlight logs stay on your device. Nothing is sent to Google for a map until you tap\nthe map link, and nothing is loaded from the problem-reporting form until you open\nit."
            }
          ]
        },
        {
          "q": "Is the app watching me?",
          "blocks": [
            {
              "t": "p",
              "html": "No. There is no analytics, no tracking and no advertising in it. It asks for a\ncamera or a location only where a feature genuinely needs one, and it tells you\nwhen it does."
            }
          ]
        },
        {
          "q": "I am on a phone with a poor signal.",
          "blocks": [
            {
              "t": "p",
              "html": "The app is built to keep working from what it last loaded. What it cannot promise\nis fresh data: a save needs the connection to reach the store, and a screen you\nleft open can show an older copy than the one on the server."
            }
          ]
        }
      ]
    },
    {
      "id": "trouble",
      "title": "When something looks wrong",
      "items": [
        {
          "q": "The first sign-in of the day took half a minute.",
          "blocks": [
            {
              "t": "p",
              "html": "That is the backend waking up, not you being slow or the app being broken. It\nsleeps after a few minutes of quiet and takes a good while to come back the first\ntime; after that it answers in a second or two. It is kept awake during working\nhours to make this rarer, but it can still happen."
            }
          ]
        },
        {
          "q": "A save said \"Not saved — press again\".",
          "blocks": [
            {
              "t": "p",
              "html": "The write did not reach the store, and the app is telling you rather than\npretending. Press Save again. If it keeps happening, the connection is the\nproblem — check it before you re-type anything."
            }
          ]
        },
        {
          "q": "Someone else's change is missing from my screen.",
          "blocks": [
            {
              "t": "p",
              "html": "Then your screen is showing what it loaded earlier. Reload the page: a page that\nis already open does not quietly pull in a newer copy of itself."
            }
          ]
        },
        {
          "q": "A banner said there is a new version. What do I do?",
          "blocks": [
            {
              "t": "p",
              "html": "Tap it, or reload. The app tells you when a newer build exists rather than\nswapping itself out under your hands mid-form. One refresh moves you onto it, and\nafter that the app's own updates are automatic."
            }
          ]
        },
        {
          "q": "I have set the app up on my phone. Does it open full screen?",
          "blocks": [
            {
              "t": "p",
              "html": "Yes — it can be installed to your home screen and opens without browser furniture,\nlike an app rather than a web page."
            }
          ]
        },
        {
          "q": "None of this helped.",
          "blocks": [
            {
              "t": "p",
              "html": "Tell the service desk. Say which ticket you were on, which section, and what you\nexpected instead — that is enough for them to find it."
            }
          ]
        }
      ]
    }
  ],
  "footer": [
    "<a href=\"index.html\">Back to I-PASSBOOK</a>",
    "This page is static: it runs no scripts, sends nothing and records nothing about\nwho read it."
  ]
};
