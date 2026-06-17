# Prep work for M2

In thinking about the practical part of implementing M2, I believe we need to do some prep work. M2's goal is to dogfood the generated OAuth server in front of the foundry portal - all in a docker/dev environment. Today, these are the steps I have to follow to spin up a blueprint generated Oauth server:

1) ensure foundry is running in my local docker dev, having the auth flag off
2) generate the zip file
3) unzip the zip file to my local file system in a fresh dir
4) run `npm install`
5) run `cp .env.example .env`
6) update the DB connection string with `foundry:foundry` for u/pwd
7) run `npm run db:init`
8) run `npm run dev`

Those are a lot of manual steps that will extend practical E2E testing when trying to get the auth server to actually work in front of foundry. Some thoughts I have:

* we work directly on the generated blueprint, making any necessary changes there, keeping track of them
* once the modified version of the OAuth server works well with foundry, we bring the changes we made into the blueprint
* then we re-test the blueprint generated version of foundry
* optional: we shorten the amount of manual steps needed to generate the OAuth server in a local dev situation
    - if you read all the milestones, I believe that is part of the outcomes anyway
    - a developer testing foundry locally, and generating anything (OAuth server being our first blueprint) shouldnt' have to go through so many manual steps, IMO

Question: can you improve on my plan, refine it, or come up with a better plan?

My intuition tells me that we aren't ready to start on M2 yet, unless the work I'm describing is actually intended to be part of M2 anyway. Thoughts?