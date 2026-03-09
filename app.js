document.addEventListener('DOMContentLoaded', () => {
    const invoiceList = document.getElementById('invoice-list');
    const detailView = document.getElementById('detail-view');
    const searchInput = document.getElementById('search');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('upload-btn');
    const clearBtn = document.getElementById('clear-btn');

    let allInvoices = [];

    const MOCK_XML_1 = `<?xml version="1.0" encoding="UTF-8"?>
<invoice>
    <invoiceNumber>DEMO-2026-001</invoiceNumber>
    <hotelId>1058303</hotelId>
    <amountBeforeTax><amount>1031.04</amount></amountBeforeTax>
    <amountAfterTax><amount>1031.04</amount><currencyCode>EUR</currencyCode></amountAfterTax>
    <taxes><taxAmount><amount>0.00</amount></taxAmount></taxes>
    <positions positionNo="117220000">
        <serviceDescription>Standard Room Night</serviceDescription>
        <amountBeforeTax><amount>128.08</amount></amountBeforeTax>
        <taxAmount><amount>0.00</amount></taxAmount>
        <amountAfterTax><amount>128.08</amount></amountAfterTax>
        <taxRate>0.00</taxRate>
    </positions>
    <positions positionNo="117220001">
        <serviceDescription>Local Tourism Fee (Adjustment Demo)</serviceDescription>
        <amountBeforeTax><amount>7.69</amount></amountBeforeTax>
        <taxAmount><amount>0.00</amount></taxAmount>
        <amountAfterTax><amount>7.69</amount></amountAfterTax>
        <taxRate>0.00</taxRate>
    </positions>
    <positions positionNo="117220002">
        <serviceDescription>Administrative Surcharge</serviceDescription>
        <amountBeforeTax><amount>11.53</amount></amountBeforeTax>
        <taxAmount><amount>0.00</amount></taxAmount>
        <amountAfterTax><amount>11.53</amount></amountAfterTax>
        <taxRate>0.00</taxRate>
    </positions>
</invoice>`;

    // --- Initialization ---

    async function init() {
        await processXMLFromString(MOCK_XML_1, "demo_invoice.xml");

        renderList(allInvoices);
        if (allInvoices.length > 0) {
            selectInvoice(0, document.querySelector('.invoice-item'));
        }
    }

    init();

    // --- File Handling ---

    uploadBtn.onclick = () => fileInput.click();

    clearBtn.onclick = () => {
        allInvoices = [];
        renderList(allInvoices);
        detailView.innerHTML = `
            <div class="detail-container empty">
                <div class="empty-state">
                    <div class="icon-pulse">📤</div>
                    <h2>No Invoices Loaded</h2>
                    <p>Select XML files or drag them here to begin reconciliation.</p>
                </div>
            </div>
        `;
    };

    fileInput.onchange = (e) => handleFiles(e.target.files);

    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    };

    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');

    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    };

    async function handleFiles(files) {
        for (let file of files) {
            if (file.type === "text/xml" || file.name.endsWith(".xml")) {
                const text = await file.text();
                await processXMLFromString(text, file.name);
            }
        }
        renderList(allInvoices);
    }

    async function processXMLFromString(xmlString, filename) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        
        const invoiceNode = xmlDoc.querySelector("invoice");
        if (!invoiceNode) return;

        const getTagText = (parent, selector, fallback = "N/A") => {
            const el = parent.querySelector(selector);
            return el ? el.textContent.trim() : fallback;
        };

        const getAmount = (parent, selector) => {
            const el = parent.querySelector(selector);
            return el ? parseFloat(el.textContent.trim()) : 0.0;
        };

        const totalNetExpected = getAmount(invoiceNode, "amountBeforeTax > amount");
        const totalGrossExpected = getAmount(invoiceNode, "amountAfterTax > amount");
        const totalTaxExpected = getAmount(invoiceNode, "taxes > taxAmount > amount");
        const currency = getTagText(invoiceNode, "amountAfterTax > currencyCode", "");
        const invNum = getTagText(invoiceNode, "invoiceNumber");
        const hotelId = getTagText(invoiceNode, "hotelId");

        const positions = [];
        const posNodes = xmlDoc.querySelectorAll("positions");
        
        posNodes.forEach(pos => {
            const pid = pos.getAttribute("positionNo") || "N/A";
            const desc = getTagText(pos, "serviceDescription");
            const date = getTagText(pos, "serviceDate");
            const net = getAmount(pos, "amountBeforeTax > amount");
            const tax = getAmount(pos, "taxAmount > amount");
            const gross = getAmount(pos, "amountAfterTax > amount");
            const taxRate = getTagText(pos, "taxRate", "0.00");

            positions.push({
                id: pid,
                description: desc,
                date: date,
                net: net,
                tax: tax,
                gross: gross,
                tax_rate: taxRate,
                original_net: net,
                original_tax: tax,
                original_gross: gross
            });
        });

        // --- Reconciliation Logic (Tax Rate Priority Implementation) ---
        const originalSumNet = positions.reduce((sum, p) => sum + p.original_net, 0);
        const originalSumTax = positions.reduce((sum, p) => sum + p.original_tax, 0);
        const originalSumGross = positions.reduce((sum, p) => sum + p.original_gross, 0);

        const diffNet = parseFloat((totalNetExpected - originalSumNet).toFixed(2));
        const diffTax = parseFloat((totalTaxExpected - originalSumTax).toFixed(2));

        function reconcileComponent(items, diff, key) {
            if (Math.abs(diff) < 0.001 || items.length === 0) return;
            
            let cents = Math.round(diff * 100);
            const step = cents > 0 ? 0.01 : -0.01;
            const absoluteCents = Math.abs(cents);

            // Optimization: If difference is massive (e.g., mock data mismatch), 
            // apply bulk changes first to avoid millions of DOM-simulated iterations.
            // For tiny discrepancies (normal use), greedy cent-by-cent is best.
            if (absoluteCents > 1000) {
                const bulkPerItem = Math.floor(absoluteCents / items.length);
                const bulkStep = (bulkPerItem * step * 100) / 100;
                if (Math.abs(bulkStep) > 0) {
                    items.forEach(p => {
                        p[key] = parseFloat((p[key] + bulkStep).toFixed(2));
                        p.gross = parseFloat((p.net + p.tax).toFixed(2));
                    });
                    cents = Math.round((parseFloat(diff.toFixed(2)) - (bulkPerItem * items.length * step)) * 100);
                }
            }

            const remainingCents = Math.abs(cents);
            for (let c = 0; c < remainingCents; c++) {
                let bestIdx = 0;
                let minErrorChange = Infinity;

                for (let i = 0; i < items.length; i++) {
                    const p = items[i];
                    const rate = parseFloat(p.tax_rate) / 100.0;
                    const currentErr = Math.abs(p.tax - (p.net * rate));

                    let newErr;
                    if (key === 'net') {
                        newErr = Math.abs(p.tax - ((p.net + step) * rate));
                    } else {
                        newErr = Math.abs((p.tax + step) - (p.net * rate));
                    }

                    const errChange = newErr - currentErr;
                    const weight = key === 'net' ? p.net : p.tax;

                    // Tie-breaker: prioritize smaller absolute values to minimize relative distortion
                    if (errChange < minErrorChange || (Math.abs(errChange - minErrorChange) < 0.0001 && Math.abs(weight) < Math.abs(items[bestIdx][key]))) {
                        minErrorChange = errChange;
                        bestIdx = i;
                    }
                }

                items[bestIdx][key] = parseFloat((items[bestIdx][key] + step).toFixed(2));
                items[bestIdx].gross = parseFloat((items[bestIdx].net + items[bestIdx].tax).toFixed(2));
            }
        }

        reconcileComponent(positions, diffNet, 'net');
        reconcileComponent(positions, diffTax, 'tax');

        const reconciledSumNet = positions.reduce((sum, p) => sum + p.net, 0);
        const reconciledSumTax = positions.reduce((sum, p) => sum + p.tax, 0);
        const reconciledSumGross = positions.reduce((sum, p) => sum + p.gross, 0);

        // --- Apply Updates to XML Document ---
        positions.forEach(p => {
            const posNode = Array.from(posNodes).find(n => n.getAttribute("positionNo") === p.id);
            if (posNode) {
                const netNode = posNode.querySelector("amountBeforeTax > amount");
                if (netNode) netNode.textContent = p.net.toFixed(2);
                const taxNode = posNode.querySelector("taxAmount > amount");
                if (taxNode) taxNode.textContent = p.tax.toFixed(2);
                const grossNode = posNode.querySelector("amountAfterTax > amount");
                if (grossNode) grossNode.textContent = p.gross.toFixed(2);
            }
        });

        const invoiceNodeTotalNet = invoiceNode.querySelector("amountBeforeTax > amount");
        if(invoiceNodeTotalNet) invoiceNodeTotalNet.textContent = reconciledSumNet.toFixed(2);
        const invoiceNodeTotalTax = invoiceNode.querySelector("taxes > taxAmount > amount");
        if(invoiceNodeTotalTax) invoiceNodeTotalTax.textContent = reconciledSumTax.toFixed(2);
        const invoiceNodeTotalGross = invoiceNode.querySelector("amountAfterTax > amount");
        if(invoiceNodeTotalGross) invoiceNodeTotalGross.textContent = reconciledSumGross.toFixed(2);

        const serializer = new XMLSerializer();
        const modifiedXmlString = serializer.serializeToString(xmlDoc);

        const data = {
            filename: filename,
            invoice_number: invNum,
            hotel_id: hotelId,
            expected_totals: { net: totalNetExpected, tax: totalTaxExpected, gross: totalGrossExpected },
            original_totals: { net: originalSumNet, tax: originalSumTax, gross: originalSumGross },
            reconciled_totals: { net: reconciledSumNet, tax: reconciledSumTax, gross: reconciledSumGross },
            currency: currency,
            items: positions,
            modified_xml: modifiedXmlString
        };

        allInvoices.push(data);
    }

    // --- UI Rendering ---

    function renderList(invoices) {
        invoiceList.innerHTML = '';
        invoices.forEach((inv, index) => {
            const li = document.createElement('li');
            li.className = 'invoice-item';
            li.innerHTML = `
                <span class="file-name">${inv.filename}</span>
                <div class="meta-info">${inv.invoice_number} | ${inv.expected_totals.gross.toFixed(2)} ${inv.currency}</div>
            `;
            li.onclick = () => selectInvoice(index, li);
            invoiceList.appendChild(li);
        });
    }

    function selectInvoice(index, element) {
        document.querySelectorAll('.invoice-item').forEach(i => i.classList.remove('active'));
        element.classList.add('active');
        
        detailView.classList.remove('empty');
        document.querySelector('.main-content').scrollTo({ top: 0, behavior: 'instant' });
        
        renderDetail(allInvoices[index]);
    }

    function renderDetail(data) {
        const template = document.getElementById('invoice-detail-template');
        const clone = template.content.cloneNode(true);

        clone.getElementById('det-filename').textContent = data.filename;
        clone.getElementById('det-inv-num').textContent = `# ${data.invoice_number}`;
        clone.getElementById('det-hotel-id').textContent = `Hotel: ${data.hotel_id}`;
        
        const total = data.expected_totals.gross;
        const original = data.original_totals.gross;
        
        const totalEl = clone.getElementById('det-total');
        totalEl.textContent = `${total.toFixed(2)} ${data.currency}`;
        
        const originalEl = clone.getElementById('det-original-total');
        originalEl.textContent = `${original.toFixed(2)} ${data.currency}`;
        
        const deltaEl = clone.getElementById('det-delta');
        const delta = total - original;
        const deltaSign = delta > 0 ? '+' : '';
        deltaEl.textContent = `${deltaSign}${delta.toFixed(2)} ${data.currency}`;
        
        if (Math.abs(delta) > 0.001) {
            originalEl.classList.add('mismatch');
            deltaEl.classList.add(delta > 0 ? 'positive' : 'negative');
        } else {
            deltaEl.textContent = `0.00 ${data.currency}`;
            deltaEl.classList.add('zero');
        }
        
        const statusPill = clone.getElementById('det-status-pill');
        const mismatch = Math.abs(total - data.reconciled_totals.gross) > 0.001;
        statusPill.textContent = mismatch ? 'Mismatch' : 'Reconciled ✓';
        statusPill.className = 'pill status-pill ' + (mismatch ? 'invalid' : 'valid');

        const itemsBody = clone.getElementById('det-items');
        data.items.forEach(item => {
            const tr = document.createElement('tr');
            
            const formatValue = (reconciled, original) => {
                if (Math.abs(reconciled - original) < 0.001) {
                    return `<span class="val-matched">${reconciled.toFixed(2)}</span>`;
                }
                return `<div class="val-diff">
                            <span class="val-original" title="Original">${original.toFixed(2)}</span>
                            <span class="val-reconciled" title="Adjusted">${reconciled.toFixed(2)}</span>
                        </div>`;
            };

            tr.innerHTML = `
                <td>${item.id}</td>
                <td>${item.description}</td>
                <td class="right" style="color: var(--text-dim); font-size: 0.8rem;">${(item.tax_rate || '0.00')}%</td>
                <td class="right">${formatValue(item.net, item.original_net)}</td>
                <td class="right">${formatValue(item.tax, item.original_tax)}</td>
                <td class="right">${formatValue(item.gross, item.original_gross)}</td>
            `;
            itemsBody.appendChild(tr);
        });

        // Summary table
        const summaryBody = clone.getElementById('det-totals-body');
        const components = [
            { label: 'NET (Before Tax)', key: 'net' },
            { label: 'TAX (Total Tax)', key: 'tax' },
            { label: 'GROSS (Total Invoice)', key: 'gross' }
        ];

        components.forEach(c => {
            const originalVal = data.original_totals[c.key];
            const reconciledVal = data.reconciled_totals[c.key];
            const targetVal = data.expected_totals[c.key];

            const trSum = document.createElement('tr');
            trSum.className = 'summary-row';
            trSum.innerHTML = `
                <td><strong>${c.label}</strong></td>
                <td class="right val-original">${originalVal.toFixed(2)}</td>
                <td class="right val-reconciled">${reconciledVal.toFixed(2)}</td>
                <td class="right"><strong>${targetVal.toFixed(2)} ${data.currency}</strong></td>
                <td class="right status-cell ${Math.abs(reconciledVal - targetVal) < 0.011 ? 'valid' : 'invalid'}">
                    ${Math.abs(reconciledVal - targetVal) < 0.011 ? 'MATCHED' : 'DISCREPANCY'}
                </td>
            `;
            summaryBody.appendChild(trSum);
        });

        detailView.innerHTML = '';
        detailView.appendChild(clone);

        const exportBtn = document.getElementById('det-export-btn');
        if (exportBtn) {
            exportBtn.onclick = () => {
                const blob = new Blob([data.modified_xml], { type: 'text/xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = data.filename.replace('.xml', '_reconciled.xml');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };
        }
    }

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allInvoices.filter(inv => 
            inv.filename.toLowerCase().includes(term) || 
            inv.invoice_number.toLowerCase().includes(term)
        );
        renderList(filtered);
    });
});
