import React, { useState } from 'react';
import { db } from '@lib/firebase';
import { writeBatch, doc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { useBulkImport } from '@shared/hooks';
import { BulkUploadLayout } from '@shared/components/admin/BulkUploadLayout';

export function BulkLeadAddingView({ onDataUpdate, onClose }) {
  const {
    csvData,
    step, setStep,
    importMethod, setImportMethod,
    sheetUrl, setSheetUrl,
    processingSheet,
    handleSheetImport,
    handleFileChange,
    reset
  } = useBulkImport();

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [stats, setStats] = useState({ created: 0, updated: 0 });

  const handleConfirmUpload = async () => {
    setUploading(true);
    setProgress('Syncing to Global Database...');
    
    let createdCount = 0;
    let updatedCount = 0;

    try {
        const batchSize = 150; 
        let currentBatch = writeBatch(db);
        let opCount = 0;

        for (let i = 0; i < csvData.length; i++) {
            const data = csvData[i];
            setProgress(`Processing ${i + 1} / ${csvData.length}...`);

            let existingDoc = null;
            let driverId = null;
            const driversRef = collection(db, "drivers");
            
            if (!data.isEmailPlaceholder) {
                const qEmail = query(driversRef, where("personalInfo.email", "==", data.email));
                const snapEmail = await getDocs(qEmail);
                if (!snapEmail.empty) existingDoc = snapEmail.docs[0];
            }

            if (!existingDoc && data.normalizedPhone) {
                const qPhone = query(driversRef, where("personalInfo.normalizedPhone", "==", data.normalizedPhone));
                const snapPhone = await getDocs(qPhone);
                if (!snapPhone.empty) existingDoc = snapPhone.docs[0];
            }

            if (existingDoc) {
                driverId = existingDoc.id;
                updatedCount++;
                const docRef = doc(db, "drivers", driverId);
                
                const updatePayload = {
                    "lastUpdatedAt": serverTimestamp(),
                    "driverProfile.isBulkUpload": true
                };
                if(data.firstName) updatePayload["personalInfo.firstName"] = data.firstName;
                if(data.lastName) updatePayload["personalInfo.lastName"] = data.lastName;
                if(data.phone) updatePayload["personalInfo.phone"] = data.phone;
                if(data.normalizedPhone) updatePayload["personalInfo.normalizedPhone"] = data.normalizedPhone;
                if(data.city) updatePayload["personalInfo.city"] = data.city;
                if(data.state) updatePayload["personalInfo.state"] = data.state;
                if(data.experience) updatePayload["qualifications.experienceYears"] = data.experience;
                if(data.driverType) updatePayload["driverProfile.type"] = data.driverType;

                currentBatch.update(docRef, updatePayload);
            } else {
                createdCount++;
                const newDriverRef = doc(collection(db, "drivers"));
                driverId = newDriverRef.id;
                
                const driverDoc = {
                    personalInfo: {
                        firstName: data.firstName,
                        lastName: data.lastName,
                        email: data.email,
                        phone: data.phone, 
                        normalizedPhone: data.normalizedPhone || '', 
                        city: data.city,
                        state: data.state,
                        zip: ''
                    },
                    driverProfile: {
                        type: data.driverType,
                        availability: 'actively_looking', 
                        isBulkUpload: true,
                        isEmailPlaceholder: !!data.isEmailPlaceholder
                    },
                    qualifications: {
                        experienceYears: data.experience || 'New'
                    },
                    createdAt: serverTimestamp(),
                    lastUpdatedAt: serverTimestamp(),
                    source: importMethod === 'gsheet' ? 'admin_gsheet_import' : 'admin_file_import'
                };
                currentBatch.set(newDriverRef, driverDoc);
            }

            const leadRef = doc(db, "leads", driverId);
            
            const leadData = {
                firstName: data.firstName,
                lastName: data.lastName,
                email: data.email,
                phone: data.phone,
                normalizedPhone: data.normalizedPhone || '',
                driverType: data.driverType,
                experience: data.experience || 'New',
                source: 'SafeHaul Network',
                createdAt: serverTimestamp(),
                unavailableUntil: null 
            };

            currentBatch.set(leadRef, leadData, { merge: true });

            opCount++; 

            if (opCount >= batchSize) {
                await currentBatch.commit();
                currentBatch = writeBatch(db);
                opCount = 0;
            }
        }

        if (opCount > 0) {
            await currentBatch.commit();
        }

        setStats({ created: createdCount, updated: updatedCount });
        setStep('success');
        if (onDataUpdate) onDataUpdate();

    } catch (err) {
        console.error("Bulk Upload Error:", err);
        alert("Error processing batch: " + err.message);
    } finally {
        setUploading(false);
    }
  };

  return (
    <BulkUploadLayout
        title="Bulk Lead Adding (Global Pool)"
        step={step}
        importMethod={importMethod}
        setImportMethod={setImportMethod}
        sheetUrl={sheetUrl}
        setSheetUrl={setSheetUrl}
        processingSheet={processingSheet}
        handleSheetImport={handleSheetImport}
        handleFileChange={handleFileChange}
        csvData={csvData}
        reset={reset}
        onConfirm={handleConfirmUpload}
        onClose={onClose} 
        uploading={uploading}
        progress={progress}
        stats={stats}
    />
  );
}