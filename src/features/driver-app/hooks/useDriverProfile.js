import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from '@lib/firebase';

const INITIAL_STATE = {
    // Job Matching
    driverType: '', availability: 'actively_looking', truckType: '',
    // Personal
    firstName: '', lastName: '', email: '', phone: '',
    street: '', city: '', state: '', zip: '', dob: '', ssn: '',
    middleName: '', suffix: '', 'known-by-other-name': 'no', otherName: '',
    'sms-consent': 'yes', 'residence-3-years': 'yes', prevStreet: '', prevCity: '', prevState: '', prevZip: '',
    // Qualifications
    'legal-work': 'yes', 'english-fluency': 'yes', 'experience-years': '',
    'drug-test-positive': 'no', 'drug-test-explanation': '', 'dot-return-to-duty': 'no',
    // License
    cdlState: '', cdlClass: '', cdlNumber: '', cdlExpiration: '', endorsements: '',
    'has-twic': 'no', twicExpiration: '',
    // History
    'consent-mvr': 'yes', 'revoked-licenses': 'no', 'driving-convictions': 'no', 'drug-alcohol-convictions': 'no',
    violations: [],
    accidents: [],
    employers: [], unemployment: [], schools: [], military: [],
    // Custom / HOS
    ein: '', driverInitials: '', businessName: '', businessStreet: '', businessCity: '', businessState: '', businessZip: '',
    expStraightTruckMiles: '0', expStraightTruckExp: '', expSemiTrailerMiles: '0', expSemiTrailerExp: '', 
    expTwoTrailersMiles: '0', expTwoTrailersExp: '',
    ec1Name: '', ec1Phone: '', ec1Relationship: '', ec1Address: '',
    ec2Name: '', ec2Phone: '', ec2Relationship: '', ec2Address: '',
    hosDay1: '', hosDay2: '', hosDay3: '', hosDay4: '', hosDay5: '', hosDay6: '', hosDay7: '',
    lastRelievedDate: '', lastRelievedTime: '',
    'has-felony': 'no', felonyExplanation: ''
};

export function useDriverProfile() {
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  // Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        navigate('/login');
        return;
      }
      setUser(currentUser);
      await loadProfile(currentUser.uid);
    });
    return () => unsubscribe();
  }, [navigate]);

  const loadProfile = async (uid) => {
    try {
      const docRef = doc(db, "drivers", uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const pi = data.personalInfo || {};
        const qual = data.qualifications || {};
        const lic = data.licenses?.[0] || {};
        const dp = data.driverProfile || {};

        setFormData(prev => ({
          ...prev,
          // Driver Profile
          driverType: dp.type || '',
          availability: dp.availability || 'actively_looking',
          truckType: dp.truckType || '',

          // Personal
          firstName: pi.firstName || '', lastName: pi.lastName || '',
          middleName: pi.middleName || '', suffix: pi.suffix || '',
          email: pi.email || '', phone: pi.phone || '',
          street: pi.street || '', city: pi.city || '', state: pi.state || '', zip: pi.zip || '',
          dob: pi.dob || '', ssn: pi.ssn || '',

          // Qualifications
          'experience-years': qual.experienceYears || '',
          'legal-work': qual.legalWork || 'yes',
          'english-fluency': qual.englishFluency || 'yes',

          // License
          cdlState: lic.state || '', cdlNumber: lic.number || '', 
          cdlExpiration: lic.expiration || '', cdlClass: lic.class || '',
          endorsements: lic.endorsements || '',

          // Arrays
          violations: data.violations || [],
          accidents: data.accidentHistory || [],
          employers: data.workHistory || []
        }));
      }
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateFormData = useCallback((name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const docRef = doc(db, "drivers", user.uid);
      const updateData = {
        driverProfile: {
            type: formData.driverType || 'unidentified',
            availability: formData.availability || 'actively_looking',
            truckType: formData.truckType || ''
        },
        personalInfo: {
            firstName: formData.firstName || '',
            lastName: formData.lastName || '',
            middleName: formData.middleName || '',
            suffix: formData.suffix || '',
            email: formData.email || '',
            phone: formData.phone || '',
            street: formData.street || '',
            city: formData.city || '',
            state: formData.state || '',
            zip: formData.zip || '',
            dob: formData.dob || '',
            ssn: formData.ssn || '',
        },
        qualifications: {
            experienceYears: formData['experience-years'] || '',
            legalWork: formData['legal-work'] || 'yes',
            englishFluency: formData['english-fluency'] || 'yes'
        },
        licenses: [{
            state: formData.cdlState || '',
            number: formData.cdlNumber || '',
            expiration: formData.cdlExpiration || '',
            class: formData.cdlClass || '',
            endorsements: formData.endorsements || ''
        }],
        workHistory: formData.employers || [],
        accidentHistory: formData.accidents || [],
        violations: formData.violations || [],
        lastUpdatedAt: serverTimestamp()
      };
      await setDoc(docRef, updateData, { merge: true });

      alert("Profile Saved Successfully!");
      navigate('/driver/dashboard');
    } catch (error) {
      console.error("Error saving profile:", error);
      alert("Failed to save. Check console.");
    } finally {
      setSaving(false);
    }
  };

  return {
      formData,
      updateFormData,
      loading,
      saving,
      handleSave,
      navigate 
  };
}