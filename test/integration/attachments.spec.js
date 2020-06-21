const path = require("path");
const fs = require("fs");
const pify = require("pify");
const tmp = require("tmp");
const {
    AttachmentManager,
    Credentials,
    MemoryStorageInterface,
    VaultManager,
    VaultSource
} = require("../../dist/index.node.js");

const IMAGE_PATH = path.resolve(__dirname, "../resources/attachments/image.png");

const readFile = pify(fs.readFile);
const stat = pify(fs.stat);

describe("AttachmentManager", function() {
    [
        {
            type: "memory",
            property: "test-vault"
        },
        {
            type: "file",
            path: path.join(tmp.dirSync().name, "vault.bcup")
        }
    ].forEach(datasourceConfig => {
        describe(`using datasource type: ${datasourceConfig.type}`, function() {
            beforeEach(async function() {
                this.vaultManager = new VaultManager({
                    cacheStorage: new MemoryStorageInterface(),
                    sourceStorage: new MemoryStorageInterface()
                });
                this.sourceCredentials = Credentials.fromDatasource(datasourceConfig, "test");
                const credsStr = await this.sourceCredentials.toSecureString();
                this.source = new VaultSource("Attachments test", datasourceConfig.type, credsStr);
                await this.vaultManager.addSource(this.source);
                await this.source.unlock(this.sourceCredentials, { initialiseRemote: true });
                this.group = this.source.vault.createGroup("test");
                this.entry = this.group.createEntry("Account").setProperty("username", "user@test.com");
            });

            it("supports attachments", async function() {
                expect(this.source.supportsAttachments()).to.be.true;
            });

            it("can add attachments", async function() {
                const attachmentData = await readFile(IMAGE_PATH);
                const attachmentID = AttachmentManager.newAttachmentID();
                const fileInfo = await stat(IMAGE_PATH);
                await this.source.attachmentManager.setAttachment(
                    this.entry,
                    attachmentID,
                    attachmentData,
                    path.basename(IMAGE_PATH),
                    "image/png",
                    fileInfo.size
                );
                const attachmentDataRead = await this.source.attachmentManager.getAttachment(this.entry, attachmentID);
                expect(attachmentData.equals(attachmentDataRead)).to.be.true;
                const details = await this.source.attachmentManager.getAttachmentDetails(this.entry, attachmentID);
                expect(details).to.deep.equal({
                    id: attachmentID,
                    name: "image.png",
                    type: "image/png",
                    size: 439968
                });
            });

            describe("with an attachment added", function() {
                beforeEach(async function() {
                    this.attachmentData = await readFile(IMAGE_PATH);
                    this.attachmentID = AttachmentManager.newAttachmentID();
                    this.attachmentID2 = AttachmentManager.newAttachmentID();
                    this.fileInfo = await stat(IMAGE_PATH);
                    await this.source.attachmentManager.setAttachment(
                        this.entry,
                        this.attachmentID,
                        this.attachmentData,
                        path.basename(IMAGE_PATH),
                        "image/png",
                        this.fileInfo.size
                    );
                    await this.source.attachmentManager.setAttachment(
                        this.entry,
                        this.attachmentID2,
                        this.attachmentData,
                        "test.png",
                        "image/png",
                        this.fileInfo.size
                    );
                });

                it("supports removing attachments", async function() {
                    await this.source.attachmentManager.removeAttachment(this.entry, this.attachmentID);
                    try {
                        await this.source.attachmentManager.getAttachment(this.entry, this.attachmentID);
                    } catch (err) {
                        expect(err).to.match(/Attachment not available/i);
                    }
                });

                it("supports listing attachments", async function() {
                    const attachments = await this.source.attachmentManager.listAttachments(this.entry);
                    const files = attachments.map(item => item.name);
                    expect(files).to.have.a.lengthOf(2);
                    expect(files).to.contain("image.png");
                    expect(files).to.contain("test.png");
                });

                it("fails to add an attachment if there's not enough free space", async function() {
                    const getAvailableStorage = (this.source._datasource.getAvailableStorage = sinon
                        .stub()
                        .callsFake(() => Promise.resolve(1000)));
                    sinon.spy(this.source._datasource, "putAttachment");
                    const newID = AttachmentManager.newAttachmentID();
                    try {
                        await this.source.attachmentManager.setAttachment(
                            this.entry,
                            newID,
                            this.attachmentData,
                            "third.png",
                            "image/png",
                            this.fileInfo.size
                        );
                    } catch (err) {
                        expect(err).to.match(/Not enough space/i);
                        expect(err).to.match(/needed = 439968 B/i);
                        expect(err).to.match(/available = 1000 B/i);
                    }
                    expect(getAvailableStorage.callCount).to.equal(1);
                    expect(this.source._datasource.putAttachment.notCalled).to.be.true;
                });

                it("fails to update an attachment if there's not enough free space", async function() {
                    const getAvailableStorage = (this.source._datasource.getAvailableStorage = sinon
                        .stub()
                        .callsFake(() => Promise.resolve(1000)));
                    sinon.spy(this.source._datasource, "putAttachment");
                    try {
                        await this.source.attachmentManager.setAttachment(
                            this.entry,
                            this.attachmentID,
                            this.attachmentData,
                            path.basename(IMAGE_PATH),
                            "image/png",
                            this.fileInfo.size + 2500
                        );
                    } catch (err) {
                        expect(err).to.match(/Not enough space/i);
                        expect(err).to.match(/needed = 2500 B/i);
                        expect(err).to.match(/available = 1000 B/i);
                    }
                    expect(getAvailableStorage.callCount).to.equal(1);
                    expect(this.source._datasource.putAttachment.notCalled).to.be.true;
                });
            });
        });
    });
});