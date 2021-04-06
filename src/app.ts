import { graphql } from '@octokit/graphql'
import fs from 'fs'

const graphqlWithAuth = graphql.defaults({
    headers: {
        authorization: `token ${process.env.github_token}`
    }
})

const repoMap = new Map()
const fileName = __dirname + '/' + process.env.file_name

let hasNext = true
let endCursor = ''
let fd: number = 0

async function main() {
    openFile(fileName)
    while (hasNext) {
        const { hasNextPage, endCursorPage }  = await getRepositories(endCursor)
        hasNext = hasNextPage
        endCursor = endCursorPage
    }

    writeToFile(fileName, 'Repository,Branch,handel.yml,handel-codepipeline.yml,last commit date,author,email\n')

    for (let [key, value] of repoMap.entries()) {
        console.log(key)
        for (let branchName of value) {
            const result = await checkBranchForHandel(key, branchName)
            // if (result.repository.handel || result.repository.pipeline) {
            //     let line = key + ',' + branchName + ','
            //     line += (result.repository.handel) ? 'yes,' : 'no,'
            //     line += (result.repository.pipeline) ? 'yes\n' : 'no\n'
            //     writeToFile(fileName, line)
            // }
            if (result.repository.handel || result.repository.pipeline) {
                let line = key + ',' + branchName + ','
                line += (result.repository.handel) ? 'yes,' : 'no,'
                line += (result.repository.pipeline) ? 'yes,' : 'no,'
                line += result.repository.commit.history.nodes[0].committedDate + ','
                line += result.repository.commit.history.nodes[0].author.name + ','
                line += result.repository.commit.history.nodes[0].author.email + '\n'
                writeToFile(fileName, line)
            }
        }
    }

    fs.close(fd, function(err) {
        if (err) {
            console.error(err)
            throw err
        }
        console.log('Closed successfully')
    })
}

function openFile(file: string) {
    fs.open(file, 'w', function (err,file) {
        if (err) {
            throw err
        }
        fd = file
        console.log('Opened successfully')
    })

}

function writeToFile(file: string, line: string) {
    // @ts-ignore
    fs.appendFile(file, line, function(err) {
        if (err) {
            console.error(err)
            throw err
        }
    })
}

async function checkBranchForHandel(repoName: string, branchName: string) {
    const handelFile = `${branchName}:handel.yml`
    const pipelineFile = `${branchName}:handel-codepipeline.yml`
    const query = `
        query checkBranchForHandel($repo: String!, $branch: String!, $handelFile: String!, $pipelineFile: String!) {
            organization(login: "byu-oit") {
                repository(name: $repo) {
                    commit: object(expression: $branch) {
                        ... on Commit {
                            history(first:1) {
                                nodes {
                                    author {
                                        name
                                        email
                                    }
                                    committedDate
                                }
                            }
                        }
                    }
                    handel: object(expression: $handelFile) {
                        ... on Blob {
                            oid
                        }
                    }
                    pipeline: object(expression: $pipelineFile) {
                        ... on Blob {
                            oid
                        }
                    }
                }
            }
        }
    `
    const { organization } = await graphqlWithAuth({
        query: query,
        repo: repoName,
        branch: branchName,
        handelFile: handelFile,
        pipelineFile: pipelineFile
    })

    return organization
}

async function getRepositories(endCursor: string) {
    let query = ''
    if (endCursor !== '') {
        query = `query repositories($endCursor: String) {
            organization(login:"byu-oit") {
                repositories(first: 100, after: $endCursor, orderBy: { field: NAME, direction: ASC }) {
                    totalCount
                    pageInfo {
                        hasNextPage
                        startCursor
                        endCursor
                    }
                    nodes {
                        name
                        isArchived
                        refs(refPrefix: "refs/heads/", first: 100) {
                            totalCount
                            nodes {
                                name
                            }
                        }
                    }
                }
            }
        }`
    } else {
        query = `query repositories {
            organization(login:"byu-oit") {
                repositories(first: 100, orderBy: { field: NAME, direction: ASC }) {
                    totalCount
                    pageInfo {
                        hasNextPage
                        startCursor
                        endCursor
                    }
                    nodes {
                        name
                        isArchived
                        refs(refPrefix: "refs/heads/", first: 100) {
                            totalCount
                            nodes {
                                name
                            }
                        }
                    }
                }
            }
        }`
    }
    const { organization } = await graphqlWithAuth({
        query: query,
        endCursor: endCursor
    })
    hasNext = organization.repositories.pageInfo.hasNextPage
    endCursor = organization.repositories.pageInfo.endCursor

    organization.repositories.nodes.forEach(function (node: any) {
        if (!node.isArchived) {
            if (!repoMap.has(node.name)) {
                repoMap.set(node.name, new Set())
            }
            if (node.refs) {
                node.refs.nodes.forEach(function (ref: any) {
                    if (!ref.name.includes("dependabot")) {
                        repoMap.get(node.name).add(ref.name)
                    }
                })
            }
        }
    })

    return {
        hasNextPage: hasNext,
        endCursorPage: endCursor
    }
}

(async () => {
    if (require.main === module) {
        await main()
    }
})()
